// The world map (#/atlas) and the war room (#/war). The map is drawn here from fixed geography: a continent split
// between the realm and its neighbours, the Orrin Isles to the west and the Free City of Austrava on its lagoon to the
// south. Colours follow each nation's mood; lines show treaties, wars and wars abroad. Every country links to its page.
import { useState } from 'preact/hooks';
import { useStore, act } from '../store';
import { Page, Sec, Card, Btn, Who, Left, When, Empty, Field, Seg, Opt } from '../ui';
import { isPM, hasPower, holderOf, standing, bal, ca, isMP, autocrat, autocratTitle, speaksForHouse, cap } from '../../../engine/index';
import { MOODS, PROFILES, TREATIES, PROVINCES, known, shipping, laneClosed } from '../../../engine/foreign';
import { power, STRATEGIES, REGIMENT_COST, MAX_REGIMENTS, BOND_PAYS, allies, EMBED_COST, termsText, garrisoned } from '../../../engine/war';
import { canMarch } from '../../../engine/backroom';
import { EmpirePanel } from './empire';

type Pt = [number, number];
const W = 1000;
const H = 660;
// where each country's heart is: its capital sits here and the borders are drawn between these points
const SITES: Record<string, Pt> = { realm: [470, 330], varnholm: [255, 215], sundmere: [500, 118], drakmoor: [815, 150], kessmark: [770, 365], tessaly: [640, 515] };
// the disputed provinces sit between the realm and a neighbour: each is its own region, coloured by whoever holds it
export const PROV_SITES: Record<string, Pt> = { kessvale: [632, 352], northfells: [492, 226], westwold: [362, 278] };

const ISLES: { at: Pt; rx: number; ry: number; seed: number }[] = [{ at: [92, 430], rx: 46, ry: 70, seed: 3 }, { at: [150, 548], rx: 40, ry: 30, seed: 7 }, { at: [62, 560], rx: 18, ry: 14, seed: 11 }];
const AUREL: Pt = [318, 618];
const CAP: Record<string, Pt> = { orrin: [104, 440], aurel: AUREL };
const LABEL: Record<string, Pt> = { orrin: [118, 382], aurel: [232, 616] };
// where each province's name goes, clear of the capital and the battle lines
const PROV_LABEL: Record<string, Pt> = { kessvale: [640, 402], northfells: [500, 240], westwold: [352, 312] };
const moodFill = ['var(--red)', 'var(--amber)', 'var(--soft)', 'var(--teal)', 'var(--teal)'];
// neutral countries show the bare parchment
const moodAlpha = [0.34, 0.3, 0, 0.22, 0.38];

// a wobbly closed outline: an ellipse roughed up with a few sine waves (the warp below makes it a coastline)
function blob(cx: number, cy: number, rx: number, ry: number, seed: number, n = 140): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const r = 1 + 0.07 * Math.sin(3 * t + seed) + 0.05 * Math.sin(7 * t + seed * 2.3) + 0.025 * Math.sin(17 * t + seed * 0.7);
    out.push([cx + Math.cos(t) * rx * r, cy + Math.sin(t) * ry * r]);
  }
  return out;
}
// keep the part of a polygon nearer to a than to b (one cut of a Voronoi cell)
export function clip(poly: Pt[], a: Pt, b: Pt): Pt[] {
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
// ---------- making it look drawn, not computed ----------
// smooth value noise, a few octaves of it, and a warp of the whole plane built from it. Every line on the map
// (coasts, borders, rivers, capitals) goes through the same warp, so neighbouring borders still meet exactly.
const hash = (x: number, y: number, s: number) => { const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); };
function noise(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
function fbm(x: number, y: number, s: number, octaves = 4) {
  let t = 0, amp = 1, f = 1, n = 0;
  for (let i = 0; i < octaves; i++) (t += amp * noise(x * f, y * f, s + i * 13)), (n += amp), (amp *= 0.5), (f *= 2);
  return t / n;
}
export const warp = ([x, y]: Pt): Pt => [x + 46 * fbm(x / 190, y / 190, 1) + 22 * fbm(x / 70, y / 70, 3, 3) + 8 * fbm(x / 26, y / 26, 5, 3), y + 46 * fbm(x / 190, y / 190, 9) + 22 * fbm(x / 70, y / 70, 11, 3) + 8 * fbm(x / 26, y / 26, 17, 3)];
// put a point every few pixels along a closed outline, so the warp has something to bend
function resample(poly: Pt[], step = 4, open = false): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length - (open ? 1 : 0); i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / step));
    for (let k = 0; k < n; k++) out.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
  }
  return out;
}
export const natural = (poly: Pt[]) => resample(poly).map(warp);
export const path = (pts: Pt[]) => 'M' + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L') + 'Z';
// an open line through points, smoothed (Catmull-Rom as cubic Béziers)
export function curve(raw: Pt[]) {
  const pts = resample(raw, 10, true).concat([raw[raw.length - 1]]).map(warp);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
const RAW_CONTINENT = blob(560, 330, 420, 245, 1.7);
export const RAW_CELLS: Record<string, Pt[]> = Object.fromEntries(Object.keys(SITES).map((k) => [k, Object.keys(SITES).reduce((poly, o) => (o === k ? poly : clip(poly, SITES[k], SITES[o])), RAW_CONTINENT)]));
// a province is a patch of land laid across a border: the coast cut down to an irregular nine-sided shape around its site
export const PROV_RAW: Record<string, Pt[]> = Object.fromEntries(Object.entries(PROV_SITES).map(([k, c], j) => [k, Array.from({ length: 9 }, (_, i) => i).reduce((poly, i) => {
  const t = (i / 9) * Math.PI * 2 + j;
  const r = 2 * (58 + 14 * Math.sin(i * 2.7 + j * 1.3));
  return clip(poly, c, [c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r * 0.8]);
}, RAW_CONTINENT)]));
const COAST = path(natural(RAW_CONTINENT));
export const CELLS: Record<string, string> = Object.fromEntries([...Object.keys(RAW_CELLS).map((k) => [k, path(natural(RAW_CELLS[k]))]), ...Object.keys(PROV_RAW).map((k) => [k, path(natural(PROV_RAW[k]))])]);
const ISLE_PATHS = ISLES.map((i) => path(natural(blob(i.at[0], i.at[1], i.rx, i.ry, i.seed, 60))));
const AUREL_PATH = path(natural(blob(AUREL[0], AUREL[1], 30, 20, 5, 50)));
const capital = (id: string): Pt => warp(CAP[id] || SITES[id] || SITES.realm);
// the lie of the land: rivers run from the hills to the sea; mountains in the north, forest in Varnholm, lakes in Sundmere
export const RIVERS: { pts: Pt[]; name?: string; at?: number }[] = [
  { pts: [[705, 70], [698, 150], [712, 210], [690, 290], [702, 380], [722, 460], [700, 600]], name: 'the Kess', at: 2 },
  { pts: [[575, 205], [530, 250], [488, 318], [462, 390], [444, 470], [430, 590]], name: 'the Ald', at: 3 },
  { pts: [[330, 150], [280, 200], [215, 250], [120, 300]] },
  { pts: [[850, 175], [830, 240], [800, 300]] }
];
const MOUNTAINS: Pt[] = [[770, 110], [800, 102], [832, 112], [860, 124], [846, 150], [884, 168], [560, 205], [586, 196], [612, 208], [540, 214], [598, 222], [330, 140], [352, 130]];
const FOREST: Pt[] = [[220, 245], [236, 262], [252, 248], [268, 270], [284, 256], [205, 280], [230, 298], [300, 285], [318, 262], [258, 300], [190, 230], [300, 170], [318, 186], [600, 560], [618, 574], [584, 576]];
const LAKES: { at: Pt; rx: number; ry: number }[] = [{ at: [430, 165], rx: 18, ry: 9 }, { at: [575, 150], rx: 12, ry: 7 }, { at: [455, 196], rx: 8, ry: 5 }];
// sea lanes from the harbour at the mouth of the Ald, round the coast to each nation's port
const HARBOUR: Pt = warp([448, 622]);
const LANES: Record<string, Pt[]> = {
  aurel: [[448, 622], [400, 645], [350, 630]],
  tessaly: [[448, 622], [560, 645], [665, 612]],
  kessmark: [[448, 622], [600, 650], [780, 632], [880, 595]],
  orrin: [[448, 622], [300, 642], [200, 600], [150, 575]],
  varnholm: [[448, 622], [300, 645], [100, 625], [40, 470], [70, 330], [130, 260]],
  sundmere: [[448, 622], [300, 645], [80, 615], [25, 420], [70, 170], [240, 40], [450, 32]],
  drakmoor: [[448, 622], [300, 645], [80, 615], [25, 420], [70, 170], [240, 40], [560, 24], [760, 36], [880, 70]]
};
const LANE_PATHS: Record<string, string> = Object.fromEntries(Object.entries(LANES).map(([k, v]) => [k, curve(v)]));
// a point a fraction of the way along a lane (by length), through the same warp
function along(pts: Pt[], t: number): Pt {
  const seg = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));
  let d = seg.reduce((a, b) => a + b, 0) * t;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i]) return warp([pts[i][0] + ((pts[i + 1][0] - pts[i][0]) * d) / seg[i], pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * d) / seg[i]]);
    d -= seg[i];
  }
  return warp(pts[pts.length - 1]);
}
export const LAKE_PATHS = LAKES.map((l, i) => path(natural(blob(l.at[0], l.at[1], l.rx, l.ry, i + 2, 30))));
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
  const ships = (w.shipping || shipping(w)) as Record<string, number>;
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
        <clipPath id="atlas-landclip"><path d={COAST} /></clipPath>
        {/* contour lines in the sea, the old engravers' way: a wide stroke, then the sea painted back over most of it */}
        {[44, 26].map((wd) => [COAST, ...ISLE_PATHS, AUREL_PATH].map((d) => <g><path d={d} class="atlas-contour" stroke-width={wd} /><path d={d} class="atlas-contour-sea" stroke-width={wd - 2.5} /></g>))}
        {[COAST, ...ISLE_PATHS, AUREL_PATH].map((d) => <path d={d} class="atlas-shallows" />)}
        <path d={COAST} class="atlas-landbase" />
        {ISLE_PATHS.map((d) => <path d={d} class="atlas-landbase" />)}
        <path d={AUREL_PATH} class="atlas-landbase" />
        {Object.keys(SITES).filter((k) => k !== 'realm').map((id) => nation(id, (f: string, a: number) => <path d={CELLS[id]} fill={f} fill-opacity={a} class="atlas-cell" />))}
        <path d={CELLS.realm} class="atlas-realm" />
        <path d={CELLS.realm} fill="url(#atlas-realm)" class="atlas-cell" />
        {/* disputed provinces, in their holder's colours */}
        {Object.keys(PROV_SITES).map((id) => {
          const owner = w.provinces?.[id]?.owner || PROVINCES[id].start;
          const shape = <><path d={CELLS[id]} class="atlas-landbase" />{owner === 'realm' ? <><path d={CELLS[id]} class="atlas-realm" /><path d={CELLS[id]} fill="url(#atlas-realm)" class="atlas-cell prov" /></> : <path d={CELLS[id]} fill={fillOf(owner)} fill-opacity={Math.max(alphaOf(owner), 0)} class="atlas-cell prov" />}</>;
          return <a href={owner === 'realm' ? '#/atlas' : '#/nation/' + owner} class="atlas-land" aria-label={`${PROVINCES[id].name}, held by ${owner === 'realm' ? 'the realm' : ns[owner]?.name}`}>{shape}{owner !== 'realm' && hatched(owner) && <path d={CELLS[id]} fill="url(#atlas-hatch)" class="atlas-cell prov" />}</a>;
        })}
        {ISLE_PATHS.map((d) => nation('orrin', (f: string, a: number) => <path d={d} fill={f} fill-opacity={a} class="atlas-cell isle" />))}
        {nation('aurel', (f: string, a: number) => <path d={AUREL_PATH} fill={f} fill-opacity={a} class="atlas-cell isle" />)}
        {/* the land itself: lakes, rivers, hills and woods, under the names */}
        <g clip-path="url(#atlas-landclip)" pointer-events="none">
          {RIVERS.map((r) => <path d={curve(r.pts)} class="atlas-river" />)}
        </g>
        <g pointer-events="none">
          {LAKE_PATHS.map((d) => <path d={d} class="atlas-lake" />)}
          {MOUNTAINS.map((m) => { const [x, y] = warp(m); return <g class="atlas-mtn"><path d={`M${x - 10},${y + 6} L${x},${y - 9} L${x + 10},${y + 6}`} /><path d={`M${x},${y - 9} L${x + 3},${y - 2} M${x + 2},${y - 4} L${x + 6},${y + 2} M${x + 5},${y} L${x + 8},${y + 5}`} class="hatch" /></g>; })}
          {FOREST.map((t) => { const [x, y] = warp(t); return <g class="atlas-tree"><line x1={x} y1={y + 2} x2={x} y2={y + 7} /><circle cx={x} cy={y - 1} r="4.2" /></g>; })}
          {RIVERS.filter((r) => r.name).map((r) => { const [x, y] = warp(r.pts[r.at!]); return <text x={x + 8} y={y} class="atlas-sea-label small">{r.name}</text>; })}
        </g>
        <path d={COAST} class="atlas-coast" />
        {ISLE_PATHS.map((d) => <path d={d} class="atlas-coast thin" />)}
        <path d={AUREL_PATH} class="atlas-coast thin" />
        <text x="40" y="150" class="atlas-sea-label">The Grey Sea</text>
        <text x="560" y="636" class="atlas-sea-label">Gulf of Austrava</text>
        <text x="300" y="40" class="atlas-sea-label">The Northern Reach</text>
        {/* sea lanes from the harbour at Aldmouth: ships for each venture at sea; a red cross where trade is shut */}
        {Object.keys(LANES).filter((id) => ns[id]).map((id) => {
          const shut = laneClosed(w, id);
          const n = Math.min(3, ships[id] || 0);
          return (
            <g pointer-events="none">
              <path d={LANE_PATHS[id]} class={'atlas-lane' + (shut ? ' shut' : n ? ' busy' : '')} />
              {shut && (() => { const [x, y] = along(LANES[id], 0.85); return <path d={`M${x - 6},${y - 6} L${x + 6},${y + 6} M${x + 6},${y - 6} L${x - 6},${y + 6}`} class="atlas-lane-x" />; })()}
              {!shut && Array.from({ length: n }, (_, i) => { const [x, y] = along(LANES[id], 0.3 + i * 0.22); return <g transform={`translate(${x},${y})`} class="atlas-ship"><path d="M-8,0 L8,0 L5,5 L-5,5 Z" /><path d="M0,0 L0,-12 L7,-2 Z" class="sail" /></g>; })}
            </g>
          );
        })}
        <g transform={`translate(${HARBOUR[0]},${HARBOUR[1]})`} class="atlas-anchor" pointer-events="none"><circle r="4" /></g>
        {Object.keys(PROV_SITES).map((id) => { const [x, y] = warp(PROV_LABEL[id]); const owner = w.provinces?.[id]?.owner || PROVINCES[id].start; return <g pointer-events="none"><text x={x} y={y} text-anchor="middle" class="atlas-prov">{PROVINCES[id].name}</text><text x={x} y={y + 13} text-anchor="middle" class="atlas-prov small">held by {owner === 'realm' ? 'us' : ns[owner]?.name.replace('Commonwealth of ', '')}</text></g>; })}
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
          const l = LABEL[id] ? warp(LABEL[id]) : [c[0], c[1] - 30];
          return (
            <g class="atlas-capital" pointer-events="none">
              <rect x={c[0] - 4} y={c[1] - 4} width="8" height="8" transform={`rotate(45 ${c[0]} ${c[1]})`} />
              <text x={c[0] + 9} y={c[1] + 15} class="atlas-town">{PROFILES[id]?.capital}</text>
              {ns[id].embassy && <path d={`M${c[0] - 12},${c[1] + 2} v-16 l10,4 l-10,4`} class="atlas-flag" />}
              <text x={l[0]} y={l[1]} text-anchor="middle" class="atlas-name">{name(id)}</text>
              {ns[id].ruler && <text x={l[0]} y={l[1] + 28} text-anchor="middle" class="atlas-prov small">ruled by {w.citizens[ns[id].ruler.id]?.name}</text>}
              <text x={l[0]} y={l[1] + 15} text-anchor="middle" class={'atlas-mood m' + ns[id].mood}>{enemy === id ? 'At war' : ns[id].protectorate ? 'Protectorate' : MOODS[ns[id].mood]} · army {known(w, id) && ns[id].power != null ? Math.round(ns[id].power) : '?'}</text>
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
          <span><i class="sw" style={{ background: 'var(--gold)', opacity: 0.6 }} /> The realm</span>
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
      <EmpirePanel compact />
      <Sec title="Disputed provinces" sub="Border lands that change hands in war. Win a war and the enemy's claimed provinces are ours; lose one and they take one back. A nation whose province we hold resents it.">
        <ul class="list">{Object.keys(PROVINCES).map((id) => {
          const pr = w.provinces?.[id] || { owner: PROVINCES[id].start };
          const o = pr.owner;
          const taken = o === 'realm' && PROVINCES[id].start !== 'realm';
          const cmd = !!w.offices.army && (hasPower(w, me, 'army') || isPM(w, me) || hasPower(w, me, 'govern'));
          return <li class="row"><span><b>{PROVINCES[id].name}</b><div class="small muted">{PROVINCES[id].blurb} Claimed by {PROVINCES[id].claims.map((n) => w.nations[n]?.name).join(' and ')}.{taken ? (pr.garrison ? ' A regiment is posted there.' : ' Taken in war and ungarrisoned: it may rise any week.') : ''}</div>{o === 'realm' && cmd && <Btn small kind="ghost" style={{ marginTop: 6 }} onClick={() => act('army.garrison', { province: id, on: !pr.garrison }, pr.garrison ? 'Garrison withdrawn.' : 'A regiment is on its way.')}>{pr.garrison ? 'Withdraw the garrison' : 'Post a garrison (1 regiment)'}</Btn>}</span><span class={'chip ' + (o === 'realm' ? 'teal' : 'red')}>{o === 'realm' ? (pr.garrison ? 'Ours · garrisoned' : 'Ours') : w.nations[o]?.name}</span></li>;
        })}</ul>
      </Sec>
      <Sec title="The nations">
        <div class="atlas-cards">
          {ns.map((n) => {
            const p = PROFILES[n.id];
            return (
              <a class="card atlas-card" href={'#/nation/' + n.id}>
                <div class="row"><b class="serif" style={{ fontSize: 19 }}>{n.name}</b><span class={'chip ' + (n.mood >= 3 ? 'teal' : n.mood <= 1 ? 'red' : 'ink')}>{w.army?.war === n.id ? 'At war' : n.protectorate ? 'Protectorate' : MOODS[n.mood]}</span></div>
                <div class="small muted">{p?.gov}, ruled from {p?.capital}. {n.ruler ? <><b>{n.ruler.title} {w.citizens[n.ruler.id]?.name}</b>, once of the realm.</> : `${p?.leader}.`}</div>
                <div class="atlas-stats small"><span>Army <b class="tnum">{known(w, n.id) && n.power != null ? `${Math.round(n.power)}/10` : 'unknown'}</b></span><span>Wealth <b class="tnum">{p?.wealth}</b>/10</span><span>{p?.exports}</span></div>
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
      <Page back={['#/world', 'The world']} kicker="At peace" title="The war room" intro={`The Army fields ${troops} regiment${troops === 1 ? '' : 's'}. War is declared ${autocrat(w) ? `by ${autocratTitle(w)}'s decree` : 'by bill'}, or by a hostile nation.`}>
        {w.army.hero && w.army.hero.until > w.now && <Card kind="tint" style={{ marginTop: 14 }}><b><Who id={w.army.hero.id} /> is a war hero.</b> <span class="small">Until <When at={w.army.hero.until} />, they weigh 4 on a coup night instead of 3.</span></Card>}
        {w.army.defeatedAt && w.now - w.army.defeatedAt < 14 * 86400000 && <Card kind="warn" style={{ marginTop: 14 }}><b>The Army came home beaten.</b> <span class="small">For two weeks after a defeat it leans towards plotters and pretenders.</span></Card>}
        <Regiments cmd={cmd} n={n} setN={setN} troops={troops} />
        <March />
        <Memorials />
        <Past />
      </Page>
    );
  }
  const enemy = w.nations[k.nation];
  const p = power(w);
  const mine = k.bonds?.[me] || 0;
  return (
    <Page back={['#/world', 'The world']} kicker={<span style={{ color: 'var(--red)' }}>At war since <When at={k.startedAt} /></span>} title={`War with ${enemy.name}`} intro={<>{k.pretender ? <>They fight to put <Who id={k.pretender} /> on our throne. </> : ''}The next battle is in <Left at={k.nextBattleAt} />. Win at +100; at −100 we are beaten. {autocrat(w) ? `${cap(autocratTitle(w))} can make peace by decree at any time.` : 'Parliament can make peace at any time with a bill.'}</>}>
      <Sec><Front score={k.score} /></Sec>
      <Terms />
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
      <Correspondents />
      <Regiments cmd={cmd} n={n} setN={setN} troops={troops} war />
      <March />
      <Memorials />
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
// the General's last resort: the Army against the government
function March() {
  const { world: w, me } = useStore();
  if (holderOf(w, 'army') !== me) return null;
  const why = canMarch(w, me);
  return (
    <Sec title="March on the capital" sub="Only you can see this.">
      <Card kind="warn"><div class="stack">
        <span class="small">Turn the Army on the {w.regime && w.regime.type !== 'civil' ? 'regime' : 'government'}. It starts a 12-hour coup night with the Army's weight (+3) behind you. Everyone declares a side; if you lose, you are treated as a failed plotter.</span>
        {why ? <span class="small muted">{why}</span> : <Btn kind="danger" onClick={() => confirm('March the Army on the capital? There is no going back.') && act('army.march', {}, 'The Army is marching.')}>Order the march</Btn>}
      </div></Card>
    </Sec>
  );
}
// war correspondents: an editor sends a reporter, and the paper prints a dispatch after every battle
function Correspondents() {
  const { world: w, me } = useStore();
  const k = w.army.campaign;
  const mine = Object.values(w.papers).find((p: any) => p.editor === me) as any;
  const sent = (k.correspondents || []) as string[];
  const latest = w.stories.filter((s: any) => s.war && s.status === 'published').slice(0, 3);
  return (
    <Sec title="From our correspondents" sub="Papers with a reporter at the front print a dispatch after every battle. Dispatches count double for the front page.">
      <div class="stack">
        {sent.length > 0 && <div class="chips">{sent.map((id) => <span class="chip ink">{w.papers[id]?.name}</span>)}</div>}
        {latest.map((s: any) => <Card><div class="kicker" style={{ margin: 0 }}>{w.papers[s.paper]?.name} · <When at={s.at} /></div><div class="serif" style={{ fontSize: 20, lineHeight: 1.15 }}>{s.headline}</div><p class="small" style={{ margin: '4px 0 0' }}>{s.body}</p></Card>)}
        {mine && !sent.includes(mine.id) && <Btn small kind="ghost" onClick={() => act('war.embed', { paper: mine.id }, 'Your reporter is on the way to the front.')}>Send a correspondent from {mine.name} ({EMBED_COST})</Btn>}
        {!sent.length && !mine && <Empty>No paper has a reporter at the front. An editor can send one.</Empty>}
      </div>
    </Sec>
  );
}
// the enemy's terms of peace, on the table for a day: MPs accept or reject
function Terms() {
  const { world: w, me } = useStore();
  const k = w.army.campaign;
  const t = k?.terms;
  if (!t || t.status !== 'open') return t ? <p class="small muted">Last terms ({termsText(w, t, w.nations[k.nation].name)}) were rejected{t.result ? `, ${t.result.ayes} to ${t.result.noes}` : ''}. New terms may come at the next payday.</p> : null;
  const v = Object.values(t.votes);
  const mine = t.votes[me];
  return (
    <Sec title="Terms of peace" sub={<>On the table for <Left at={t.closesAt} />. {autocrat(w) ? `${cap(autocratTitle(w))} alone accepts or rejects them.` : 'A majority of MPs voting makes peace on these terms; otherwise the war goes on.'}</>}>
      <Card kind="warn"><div class="stack">
        <b class="serif" style={{ fontSize: 20 }}>{w.nations[k.nation].name} proposes: {termsText(w, t, w.nations[k.nation].name)}.</b>
        <span class="small">{autocrat(w) ? '' : `${v.filter((x) => x).length} accept, ${v.filter((x) => !x).length} reject so far.`}{t.kind === 'hostage' ? ' A hostage spends a week in exile abroad, and comes home to +5 approval.' : ''}</span>
        {speaksForHouse(w, me) ? <div class="grid2"><Btn kind={mine === true ? undefined : 'ghost'} onClick={() => act('war.terms', { yes: true }, 'You vote to accept.')}>Accept{mine === true ? ' ✓' : ''}</Btn><Btn kind={mine === false ? 'danger' : 'danger ghost'} onClick={() => act('war.terms', { yes: false }, 'You vote to fight on.')}>Reject{mine === false ? ' ✓' : ''}</Btn></div> : <span class="small muted">{autocrat(w) ? `Only ${autocratTitle(w)} decides.` : 'Only MPs vote. Lobby yours.'}</span>}
      </div></Card>
    </Sec>
  );
}
// after a war, MPs choose the names for its memorial
function Memorials() {
  const { world: w, me } = useStore();
  const open = (w.memorials || []).filter((m: any) => m.status === 'open') as any[];
  const [pick, setPick] = useState<Record<string, string[]>>({});
  if (!open.length) return null;
  return (
    <Sec title="The war memorial" sub={autocrat(w) ? `Whose names are carved? ${cap(autocratTitle(w))} chooses. Each gets a stamp, a pension and a place in the Hall of Fame.` : 'Whose names are carved? A name backed by a majority of MPs voting goes on it, with a stamp, a pension and a place in the Hall of Fame.'}>
      {open.map((m) => {
        const chosen = pick[m.id] ?? m.votes[me] ?? m.names;
        return (
          <Card><div class="stack">
            <b>The {w.nations[m.nation]?.name} war</b>
            <span class="small muted">Closes in <Left at={m.closesAt} />.{autocrat(w) ? '' : ` ${Object.keys(m.votes).length === 1 ? '1 MP has' : `${Object.keys(m.votes).length} MPs have`} voted.`}</span>
            {m.names.map((id: string) => <label class="tick"><input type="checkbox" checked={chosen.includes(id)} disabled={!speaksForHouse(w, me)} onChange={(e: any) => setPick({ ...pick, [m.id]: e.target.checked ? [...chosen, id] : chosen.filter((x: string) => x !== id) })} /><span><Who id={id} />{holderOf(w, 'army') === id ? ', the General' : ', volunteer'}</span></label>)}
            {speaksForHouse(w, me) && <Btn small onClick={() => act('war.memorial', { memorial: m.id, names: chosen }, 'Your choice is recorded.')}>{m.votes[me] ? 'Change my choice' : 'Choose these names'}</Btn>}
          </div></Card>
        );
      })}
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
            <div><span class="small muted">Ruled by</span><b>{n.ruler ? `${n.ruler.title} ${w.citizens[n.ruler.id]?.name}` : p.leader}</b>{n.ruler && <span class="small muted">A defector from the realm</span>}</div>
            <div><span class="small muted">Army</span><b class="tnum">{known(w, id) && n.power != null ? `${Math.round(n.power * 10) / 10} / 10` : 'Unknown'}</b>{!(known(w, id) && n.power != null) && <span class="small muted">Open an embassy or ask the Security Service</span>}</div>
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
