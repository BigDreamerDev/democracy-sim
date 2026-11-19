// Ceremonies: short animated scenes for the great moments of the realm, in the spirit of the coronation film.
// The engine tags a Gazette entry with `fx` ({ k, who, by, title, place, to }, engine/core.ts gazette()); this plays
// the ones you have not seen (from the last two days, at most four at a time, a battle only once), or any one on
// demand (the 'realm-ceremony' event, used by #/ceremonies). Tap to go on; "Turn off" stops them coming by themselves.
import { useEffect, useState } from 'preact/hooks';
import { useStore } from './store';
import { nm } from '../../engine/index';

const SEEN = 'realm-fx-seen';
const OFF = 'realm-fx-off';
const LONG = 5600;
export const fxOff = () => { try { return localStorage.getItem(OFF) === '1'; } catch { return false; } };
export const setFxOff = (off: boolean) => { try { localStorage.setItem(OFF, off ? '1' : '0'); } catch {} };
export const playCeremony = (fx: any) => window.dispatchEvent(new CustomEvent('realm-ceremony', { detail: fx }));

const STRAT: Record<string, string> = { hold: 'Hold the line', advance: 'Advance', raid: 'Raid' };
const OFFICE: Record<string, [string, string]> = {
  chamberlain: ['The Lord Chamberlain', 'key'], privyseal: ['The Lord Privy Seal', 'seal'], highcommission: ['Imperial High Commissioner', 'laurel'],
  army: ['General of the Army', 'swords'], treasury: ['Chancellor of the Treasury', 'coins'], foreign: ['Foreign Minister', 'flag'], security: ['Director of the Security Service', 'eye']
};
const ITEM: Record<string, string> = { artillery: 'cannon', cavalry: 'horse', ironclad: 'ship', airship: 'airship', fort: 'fort' };

// what each moment says, and which emblem it shows
export function scene(w: any, fx: any): { emblem: string; kicker: string; name: string; sub: string; tone?: string } {
  const who = (id: any) => (id && w.citizens[id] ? nm(w, id) : '');
  const sov = w.hos?.holder ? `${w.config.hosTitle || 'the Sovereign'} ${who(w.hos.holder)}` : 'the Sovereign';
  switch (fx.k) {
    case 'sworn': return { emblem: 'crown', kicker: 'Sworn of the Privy Council', name: who(fx.who), sub: `Privy Councillor, by command of ${sov}` };
    case 'appoint': { const o = OFFICE[fx.office] || [fx.title, 'seal']; return { emblem: o[1], kicker: 'Appointed', name: who(fx.who), sub: `${o[0]}${fx.by && fx.by !== fx.who ? `, by ${who(fx.by)}` : ''}` }; }
    case 'governor': return { emblem: 'sash', kicker: `Governor of ${fx.place}`, name: who(fx.who), sub: 'Appointed by the Imperial High Commission' };
    case 'gdecree': return { emblem: 'scroll', kicker: `By decree of the Governor of ${fx.place}`, name: fx.title, sub: who(fx.who) };
    case 'council': return { emblem: 'crown', kicker: 'Parliament is dissolved', name: 'The Imperial Privy Council', sub: 'Eight sit in Council. Its Orders are the law.' };
    case 'empire': return { emblem: 'crown', kicker: 'Proclaimed', name: fx.place || w.config.realmName, sub: fx.who ? `${fx.title || ''} ${who(fx.who)}`.trim() : 'An Empire' };
    case 'force': return { emblem: 'scroll', kicker: 'Forced through the Council', name: fx.title, sub: `By ${fx.role || 'command'}, ${who(fx.by)}`, tone: 'gold' };
    case 'veto': return { emblem: 'veto', kicker: 'Vetoed', name: fx.title, sub: `By ${fx.role || 'the Crown'}, ${who(fx.by)}`, tone: 'red' };
    case 'seal': return { emblem: 'seal', kicker: 'The Imperial Seal is set', name: fx.title, sub: `By the Lord Privy Seal, ${who(fx.by)}` };
    case 'summon': return { emblem: 'bell', kicker: 'The Council is summoned', name: fx.title, sub: 'To the vote within the hour' };
    case 'invade': return { emblem: 'map', kicker: 'War', name: `The invasion of ${fx.place}`, sub: 'The Army crosses the border', tone: 'red' };
    case 'invaded': return { emblem: 'mapin', kicker: 'To arms', name: `${fx.place} invades`, sub: 'The enemy is across the border', tone: 'red' };
    case 'orders': return { emblem: fx.title === 'advance' ? 'map' : fx.title === 'raid' ? 'horse' : 'fort', kicker: 'New orders at the front', name: STRAT[fx.title] || fx.title, sub: fx.place ? `Against ${fx.place}` : '' };
    case 'battle': return { emblem: fx.won ? 'swords' : 'broken', kicker: fx.won ? 'Victory in the field' : 'Defeat in the field', name: `At ${fx.place}`, sub: `The front stands at ${fx.score > 0 ? '+' : ''}${fx.score}`, tone: fx.won ? 'gold' : 'red' };
    case 'victory': return { emblem: 'laurel', kicker: 'Victory', name: `${fx.place} sues for peace`, sub: fx.who ? `${who(fx.who)} comes home a hero` : 'The Army comes home', tone: 'gold' };
    case 'defeat': return { emblem: 'broken', kicker: 'Defeat', name: `Beaten by ${fx.place}`, sub: 'The Army comes home', tone: 'red' };
    case 'memorial': return { emblem: 'laurel', kicker: 'Unveiled', name: `The ${fx.place} war memorial`, sub: 'Their names are carved in stone' };
    case 'march': return { emblem: 'march', kicker: 'The Army marches', name: fx.place, sub: 'A regiment takes up garrison' };
    case 'raise': return { emblem: 'swords', kicker: 'To the colours', name: `${fx.n} new regiment${fx.n === 1 ? '' : 's'}`, sub: 'Raised for the Army' };
    case 'procure': return { emblem: ITEM[fx.item] || 'cannon', kicker: 'Military acquisition', name: fx.title, sub: fx.place ? `In ${fx.place}` : `For the Army, by ${who(fx.by)}` };
    case 'acquire': return { emblem: 'certificate', kicker: 'Acquisition', name: fx.title, sub: 'Now directed by the Imperial High Commission' };
    case 'production': return { emblem: 'cannon', kicker: 'War production', name: fx.title, sub: 'The works turn to the war' };
    case 'protectorate': return { emblem: 'flag', kicker: 'Under imperial protection', name: fx.place, sub: 'A new protectorate of the empire' };
    case 'levy': return { emblem: 'coins', kicker: 'An imperial levy', name: fx.place, sub: 'Tribute for the war chest' };
    default: return { emblem: 'seal', kicker: '', name: fx.title || '', sub: '' };
  }
}

// the emblems: drawn in gold line, each with its own motion (styles.css: .cer-e-*)
function Emblem({ e }: { e: string }) {
  const g = { fill: 'none', stroke: 'currentColor', 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as any;
  const body: Record<string, any> = {
    crown: <g {...g}><path class="draw" d="M40 140 L30 70 L70 105 L100 50 L130 105 L170 70 L160 140 Z" /><path class="draw" d="M40 155 H160" /><circle cx="100" cy="45" r="7" /><circle cx="28" cy="66" r="6" /><circle cx="172" cy="66" r="6" /><circle cx="100" cy="122" r="8" class="jewel" /></g>,
    key: <g {...g}><circle class="draw" cx="62" cy="100" r="26" /><circle cx="62" cy="100" r="9" /><path class="draw" d="M88 100 H170 M150 100 V122 M165 100 V116 M135 100 V118" /></g>,
    seal: <g><circle cx="100" cy="100" r="58" class="wax" /><path class="drip" d="M70 148 q6 22 12 0 M118 152 q5 18 10 0" fill="#7a1420" /><circle cx="100" cy="100" r="44" fill="none" stroke="#e8b4a0" stroke-width="2" opacity=".6" /><text x="100" y="118" text-anchor="middle" font-size="52" fill="#f2c9b8" font-family="Gloock, serif">✠</text></g>,
    laurel: <g {...g}><path class="draw" d="M100 165 C55 150 40 110 50 60 M100 165 C145 150 160 110 150 60" />{[0, 1, 2, 3, 4].map((i) => <g class="leaf" style={{ animationDelay: `${0.5 + i * 0.12}s` }}><ellipse cx={58 - i * 2} cy={150 - i * 20} rx="12" ry="6" transform={`rotate(${-50 + i * 8} ${58 - i * 2} ${150 - i * 20})`} /><ellipse cx={142 + i * 2} cy={150 - i * 20} rx="12" ry="6" transform={`rotate(${50 - i * 8} ${142 + i * 2} ${150 - i * 20})`} /></g>)}<path d="M100 70 l8 18 20 2 -15 13 5 19 -18 -10 -18 10 5 -19 -15 -13 20 -2z" class="star" /></g>,
    swords: <g {...g}><g class="blade-l"><path d="M45 155 L150 50" /><path d="M58 128 L72 142 M40 160 l10 -10" /></g><g class="blade-r"><path d="M155 155 L50 50" /><path d="M142 128 L128 142 M160 160 l-10 -10" /></g></g>,
    broken: <g {...g}><path d="M45 155 L95 105" /><path class="shard" d="M108 92 L155 45" /><path d="M58 128 L72 142" /><path d="M95 105 l8 -2 -2 8" /></g>,
    scroll: <g {...g}><rect class="paper" x="50" y="40" width="100" height="120" rx="4" fill="#f6ebdc" stroke="currentColor" /><path d="M66 70 H134 M66 88 H134 M66 106 H120" stroke="#9b8a6e" stroke-width="3" /><g class="stamp"><circle cx="128" cy="138" r="24" fill="#c9a13b" stroke="#7a5a1e" /><text x="128" y="146" text-anchor="middle" font-size="22" fill="#5e1b3c" stroke="none" font-family="Gloock, serif">✠</text></g></g>,
    veto: <g><rect x="44" y="40" width="112" height="120" rx="4" fill="#f6ebdc" class="paper" /><path d="M60 70 H140 M60 88 H140 M60 106 H125" stroke="#9b8a6e" stroke-width="3" /><g class="stamp"><rect x="30" y="80" width="140" height="48" rx="4" fill="none" stroke="#c0392b" stroke-width="6" transform="rotate(-12 100 104)" /><text x="100" y="118" text-anchor="middle" font-size="38" font-weight="700" fill="#c0392b" letter-spacing="6" transform="rotate(-12 100 104)" font-family="Atkinson Hyperlegible, sans-serif">VETO</text></g></g>,
    bell: <g {...g} class="swing"><path d="M100 40 v12 M60 140 C62 90 70 60 100 56 C130 60 138 90 140 140 Z M50 140 H150" /><circle cx="100" cy="152" r="9" class="clapper" /></g>,
    sash: <g {...g}><path class="draw" d="M40 40 L160 160" stroke-width="18" stroke="#5e1b3c" /><path class="draw" d="M40 40 L160 160" stroke-width="4" /><g class="medal"><path d="M100 100 l-14 -26 h28 z" fill="#5e1b3c" /><circle cx="100" cy="118" r="20" fill="#c9a13b" stroke="#7a5a1e" /><path d="M100 106 l4 8 9 1 -7 6 2 9 -8 -5 -8 5 2 -9 -7 -6 9 -1z" fill="#5e1b3c" stroke="none" /></g></g>,
    map: <g><path class="coast" d="M20 120 C40 80 70 90 90 70 C110 50 140 60 160 40 C175 60 185 100 170 130 C150 160 110 150 80 165 C50 175 30 150 20 120Z" fill="#2a1a20" stroke="currentColor" stroke-width="2" /><path class="border" d="M100 62 C95 95 105 120 98 160" stroke="currentColor" stroke-dasharray="6 6" stroke-width="2" fill="none" /><path class="arrow" d="M40 125 C70 120 100 110 140 95" stroke="#e05a4a" stroke-width="7" fill="none" stroke-linecap="round" /><path class="arrowhead" d="M132 84 L150 92 L136 106" stroke="#e05a4a" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round" /><path class="arrow a2" d="M50 145 C80 140 105 135 135 125" stroke="#e05a4a" stroke-width="5" fill="none" stroke-linecap="round" opacity=".7" /></g>,
    mapin: <g><path class="coast" d="M20 120 C40 80 70 90 90 70 C110 50 140 60 160 40 C175 60 185 100 170 130 C150 160 110 150 80 165 C50 175 30 150 20 120Z" fill="#2a1a20" stroke="currentColor" stroke-width="2" /><path class="border" d="M100 62 C95 95 105 120 98 160" stroke="currentColor" stroke-dasharray="6 6" stroke-width="2" fill="none" /><path class="arrow" d="M165 95 C135 100 105 110 65 125" stroke="#e05a4a" stroke-width="7" fill="none" stroke-linecap="round" /><path class="arrowhead" d="M74 112 L56 128 L76 136" stroke="#e05a4a" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round" /></g>,
    march: <g {...g}><path d="M20 160 H180" opacity=".5" />{[0, 1, 2, 3].map((i) => <g class="soldier" style={{ animationDelay: `${i * 0.18}s` }} transform={`translate(${30 + i * 34} 0)`}><circle cx="10" cy="92" r="7" /><path d="M10 100 V130 M10 130 l-8 28 M10 130 l8 28 M10 108 l-10 14 M10 108 l12 -18 M22 90 V70" /></g>)}<path class="pennant" d="M168 60 V150 M168 62 l-26 10 26 10" /></g>,
    cannon: <g {...g}><g class="barrel"><rect x="40" y="88" width="100" height="26" rx="10" fill="#2a1a20" /><circle cx="140" cy="101" r="5" /></g><circle cx="80" cy="132" r="22" /><circle cx="80" cy="132" r="5" /><circle class="puff" cx="160" cy="98" r="14" fill="#f6ebdc" stroke="none" /><circle class="puff p2" cx="174" cy="90" r="10" fill="#f6ebdc" stroke="none" /></g>,
    horse: <g {...g}><path class="draw" d="M55 150 C50 90 60 60 100 50 C140 60 150 90 145 150" stroke-width="14" /><path d="M58 75 h-8 M60 100 h-9 M60 125 h-9 M142 75 h8 M140 100 h9 M140 125 h9" stroke-width="3" /></g>,
    ship: <g {...g}><g class="bob"><path d="M30 120 H170 L150 150 H50 Z" fill="#2a1a20" /><rect x="70" y="92" width="60" height="28" /><path d="M90 92 V60 M110 92 V70" /><circle class="puff" cx="92" cy="50" r="9" fill="#f6ebdc" stroke="none" /></g><path class="wave" d="M10 160 q15 -10 30 0 t30 0 t30 0 t30 0 t30 0 t30 0" stroke-width="3" /></g>,
    airship: <g {...g}><g class="float"><ellipse cx="100" cy="80" rx="70" ry="28" fill="#2a1a20" /><path d="M40 80 H160 M100 52 V108" opacity=".5" /><path d="M170 80 l14 -12 v24 z" /><path d="M80 108 l-6 20 h52 l-6 -20" /></g></g>,
    fort: <g {...g}><path class="build" d="M40 160 V90 h20 v12 h16 v-12 h20 v12 h16 v-12 h20 v12 h16 v-12 h12 V160 Z" fill="#2a1a20" /><path d="M90 160 v-28 a10 10 0 0 1 20 0 v28" /><path class="pennant" d="M100 90 V50 M100 52 l24 9 -24 9" /></g>,
    certificate: <g><rect class="paper" x="30" y="50" width="140" height="100" rx="4" fill="#f6ebdc" stroke="#c9a13b" stroke-width="4" /><rect x="40" y="60" width="120" height="80" fill="none" stroke="#c9a13b" stroke-width="1.5" /><text x="100" y="92" text-anchor="middle" font-size="13" fill="#5e1b3c" font-family="Gloock, serif" letter-spacing="2">SHARE CERTIFICATE</text><path d="M60 108 H140 M70 120 H130" stroke="#9b8a6e" stroke-width="2" /><g class="stamp"><circle cx="146" cy="138" r="20" fill="#5e1b3c" /><text x="146" y="145" text-anchor="middle" font-size="18" fill="#e3c16f" font-family="Gloock, serif">✠</text></g></g>,
    flag: <g {...g}><path d="M60 170 V30" /><g class="rise"><path class="cloth" d="M62 34 C90 24 110 46 150 36 V86 C110 96 90 74 62 84 Z" fill="#5e1b3c" /><text x="104" y="68" text-anchor="middle" font-size="26" fill="#e3c16f" stroke="none" font-family="Gloock, serif">✠</text></g></g>,
    coins: <g {...g}>{[0, 1, 2, 3, 4, 5].map((i) => <g class="coin" style={{ animationDelay: `${0.2 + i * 0.16}s` }}><ellipse cx={60 + (i % 3) * 40} cy={60} rx="16" ry="16" fill="#c9a13b" stroke="#7a5a1e" /><text x={60 + (i % 3) * 40} y={66} text-anchor="middle" font-size="16" fill="#5e1b3c" stroke="none">✠</text></g>)}<path d="M40 160 H160" /></g>,
    eye: <g {...g}><path class="draw" d="M25 100 C60 50 140 50 175 100 C140 150 60 150 25 100 Z" /><circle cx="100" cy="100" r="22" class="jewel" /></g>
  };
  return <svg class={'cer-emblem cer-e-' + e} viewBox="0 0 200 200" aria-hidden="true">{body[e] || body.seal}</svg>;
}

export function Scene({ w, fx }: { w: any; fx: any }) {
  const s = scene(w, fx);
  return (
    <div class={'cer-scene cer-k-' + fx.k + (s.tone ? ' tone-' + s.tone : '')}>
      <div class="cer-rays" />
      <div class="cer-sparks">{Array.from({ length: 14 }, (_, i) => <i style={{ left: `${(i * 37) % 100}%`, animationDelay: `${1 + (i % 7) * 0.25}s` }} />)}</div>
      <Emblem e={s.emblem} />
      <div class="cer-kicker">{s.kicker}</div>
      <div class="cer-name">{s.name}</div>
      <div class="cer-rule" />
      <div class="cer-sub">{s.sub}</div>
      <div class="cer-realm">{w.config.realmName}</div>
    </div>
  );
}

const visible = (fx: any, me: string) => !fx.to || fx.to.includes(me) || fx.by === me || fx.who === me;

export function Ceremony() {
  const { world: w, me } = useStore();
  const [queue, setQueue] = useState<any[]>([]);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!w?.gazette || fxOff()) return;
    let seen = 0;
    try { seen = Number(localStorage.getItem(SEEN) || 0); } catch {}
    if (!seen) seen = w.now - 12 * 3600000;
    const fresh = (w.gazette as any[]).filter((g) => g.fx && g.at > seen && w.now - g.at < 2 * 86400000 && visible(g.fx, me));
    if (!fresh.length) return;
    // newest first in the Gazette: keep one battle, then the newest four, played oldest first
    const out: any[] = [];
    let battle = false;
    for (const g of fresh) { if (g.fx.k === 'battle') { if (battle) continue; battle = true; } out.push(g.fx); if (out.length === 4) break; }
    try { localStorage.setItem(SEEN, String(w.gazette[0]?.at || w.now)); } catch {}
    setQueue((q) => [...q, ...out.reverse()]);
  }, [w?.gazette?.[0]?.id]);
  useEffect(() => {
    const show = (e: any) => setQueue((q) => [...q, e.detail]);
    window.addEventListener('realm-ceremony', show);
    return () => window.removeEventListener('realm-ceremony', show);
  }, []);
  const fx = queue[0];
  useEffect(() => {
    if (!fx) return;
    const t = setTimeout(() => (setQueue((q) => q.slice(1)), setN((x) => x + 1)), LONG);
    return () => clearTimeout(t);
  }, [fx, n]);
  if (!fx || !w) return null;
  const next = () => (setQueue((q) => q.slice(1)), setN((x) => x + 1));
  return (
    <div class="cer" role="dialog" aria-label="A ceremony" onClick={next}>
      <Scene key={n} w={w} fx={fx} />
      <div class="cer-bar" onClick={(e) => e.stopPropagation()}>
        {queue.length > 1 && <span class="cer-count">{queue.length - 1} more</span>}
        <button onClick={next}>{queue.length > 1 ? 'Next' : 'Close'}</button>
        {queue.length > 1 && <button onClick={() => setQueue([])}>Skip all</button>}
        <button onClick={() => (setFxOff(true), setQueue([]))}>Turn off</button>
      </div>
    </div>
  );
}
