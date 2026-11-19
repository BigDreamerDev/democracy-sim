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
    case 'oath': return { emblem: 'oath', kicker: 'Sworn', name: who(fx.who), sub: `The Imperial Oath, to ${sov}` };
    case 'oathcall': return { emblem: 'oath', kicker: 'By Imperial command', name: 'The Imperial Oath', sub: 'Every citizen is called to swear allegiance' };
    case 'refuse': return { emblem: 'broken', kicker: 'Refused the Imperial Oath', name: who(fx.who), sub: 'And loses every office', tone: 'red' };
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

// the emblems: gold leaf on porphyry, each with its own motion (styles.css: .cer-e-*). Every moving part has its own
// group with transform-box: fill-box, so it turns about its own centre; the SVG's own transforms sit on a parent.
function Emblem({ e }: { e: string }) {
  const id = 'em-' + e;
  const gold = `url(#${id}-gold)`;
  const steel = `url(#${id}-steel)`;
  const line = { fill: 'none', stroke: gold, 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as any;
  const sword = (flip: boolean, cls: string) => (
    <g class={cls}><g transform={flip ? 'translate(200 0) scale(-1 1)' : undefined}>
      <path d="M150 30 L162 38 L82 132 L74 124 Z" fill={steel} stroke="#5b6470" stroke-width="1.5" />
      <path d="M156 34 L80 128" stroke="#fff" stroke-opacity=".55" stroke-width="1.5" />
      <path d="M60 112 L94 146" stroke={gold} stroke-width="9" stroke-linecap="round" />
      <path d="M77 129 L52 154" stroke="#3b0f25" stroke-width="9" stroke-linecap="round" />
      <path d="M77 129 L52 154" stroke={gold} stroke-width="9" stroke-linecap="round" stroke-dasharray="3 5" />
      <circle cx="47" cy="159" r="8" fill={gold} />
    </g></g>
  );
  const coast = 'M18 118 C30 84 58 88 76 70 C92 54 118 62 136 46 C154 34 176 50 182 76 C190 104 178 136 156 150 C132 166 104 152 80 166 C56 178 26 160 18 118 Z';
  const body: Record<string, any> = {
    crown: <g><path class="fillin" d="M44 140 L32 72 L70 104 L100 52 L130 104 L168 72 L156 140 Z" fill={gold} opacity=".22" /><path class="draw" pathLength={1} {...line} d="M44 140 L32 72 L70 104 L100 52 L130 104 L168 72 L156 140 Z" /><rect class="fillin" x="40" y="142" width="120" height="14" rx="3" fill={gold} /><g class="gems"><circle cx="100" cy="46" r="7" fill={gold} /><circle cx="30" cy="67" r="6" fill={gold} /><circle cx="170" cy="67" r="6" fill={gold} /><circle cx="70" cy="149" r="4" fill="#9b1b2a" /><circle cx="100" cy="149" r="5" fill="#1f5e57" /><circle cx="130" cy="149" r="4" fill="#9b1b2a" /><circle class="jewel" cx="100" cy="118" r="9" fill="#c0392b" stroke={gold} stroke-width="2" /></g></g>,
    key: <g class="turn"><circle {...line} stroke-width="7" cx="62" cy="100" r="28" /><path {...line} stroke-width="3" d="M62 80 l8 20 -8 20 -8 -20 z" /><path d="M90 100 H172" stroke={gold} stroke-width="10" stroke-linecap="round" /><path d="M136 100 v24 h10 v-14 h8 v18 h10 v-28" fill={gold} stroke={gold} stroke-width="3" stroke-linejoin="round" /></g>,
    seal: <g class="press"><path d="M100 40 C122 38 142 48 152 64 C166 78 162 100 160 112 C164 130 150 150 132 156 C116 166 92 164 76 156 C56 150 40 132 42 112 C36 92 44 70 58 58 C70 46 84 42 100 40 Z" fill={`url(#${id}-wax)`} /><circle cx="100" cy="102" r="42" fill="none" stroke="#5e0f18" stroke-width="3" opacity=".7" /><circle cx="100" cy="102" r="36" fill="none" stroke="#e8a090" stroke-width="1" opacity=".35" /><text x="100" y="120" text-anchor="middle" font-size="50" fill="#f2b8a6" opacity=".9" font-family="Gloock, serif">✠</text><path d="M80 154 l-10 34 12 -8 6 12 6 -36" fill="#7a1420" class="tail" /><path d="M118 154 l12 32 -12 -6 -6 12 -4 -36" fill="#7a1420" class="tail t2" /></g>,
    laurel: <g><path class="draw" pathLength={1} {...line} d="M100 168 C58 154 40 116 48 64 M100 168 C142 154 160 116 152 64" />{[0, 1, 2, 3, 4].map((i) => <g class="leaf" style={{ animationDelay: `${0.5 + i * 0.12}s` }}><g transform={`rotate(${-48 + i * 8} ${57 - i * 2} ${150 - i * 20})`}><ellipse cx={57 - i * 2} cy={150 - i * 20} rx="13" ry="6" fill={gold} /></g><g transform={`rotate(${48 - i * 8} ${143 + i * 2} ${150 - i * 20})`}><ellipse cx={143 + i * 2} cy={150 - i * 20} rx="13" ry="6" fill={gold} /></g></g>)}<path class="star" d="M100 66 l9 19 21 3 -15 15 4 21 -19 -10 -19 10 4 -21 -15 -15 21 -3z" fill={gold} /></g>,
    swords: <g>{sword(false, 'blade-l')}{sword(true, 'blade-r')}</g>,
    broken: <g><g class="hilt"><path d="M118 92 L130 82 L82 132 L74 124 Z" fill={steel} stroke="#5b6470" stroke-width="1.5" /><path d="M60 112 L94 146" stroke={gold} stroke-width="9" stroke-linecap="round" /><path d="M77 129 L52 154" stroke={gold} stroke-width="9" stroke-linecap="round" /><circle cx="47" cy="159" r="8" fill={gold} /></g><g class="shard"><path d="M150 30 L162 38 L134 72 L124 66 Z" fill={steel} stroke="#5b6470" stroke-width="1.5" /></g></g>,
    scroll: <g><g class="paper"><rect x="52" y="44" width="96" height="116" fill="#f4e6cc" /><path d="M66 70 H134 M66 86 H134 M66 102 H134 M66 118 H112" stroke="#b49c74" stroke-width="3" stroke-linecap="round" /></g><rect x="44" y="34" width="112" height="14" rx="7" fill={gold} /><rect class="rod-b" x="44" y="156" width="112" height="14" rx="7" fill={gold} /><g class="stamp"><circle cx="128" cy="136" r="22" fill={`url(#${id}-wax)`} /><text x="128" y="144" text-anchor="middle" font-size="22" fill="#f2b8a6" font-family="Gloock, serif">✠</text></g></g>,
    veto: <g><g class="paper"><rect x="48" y="40" width="104" height="124" rx="3" fill="#f4e6cc" /><path d="M62 66 H138 M62 82 H138 M62 98 H138 M62 114 H120" stroke="#b49c74" stroke-width="3" stroke-linecap="round" /></g><g class="stamp"><g transform="rotate(-12 100 104)"><rect x="30" y="80" width="140" height="48" rx="5" fill="#c0392b" fill-opacity=".08" stroke="#c0392b" stroke-width="6" /><text x="100" y="117" text-anchor="middle" font-size="36" font-weight="700" fill="#c0392b" letter-spacing="7" font-family="Atkinson Hyperlegible, sans-serif">VETO</text></g></g></g>,
    bell: <g class="swing"><path d="M100 34 v14" stroke={gold} stroke-width="6" stroke-linecap="round" /><path d="M100 48 C70 52 62 82 60 134 L50 146 H150 L140 134 C138 82 130 52 100 48 Z" fill={gold} /><path d="M78 70 C72 90 70 110 70 132" stroke="#fff4d0" stroke-width="4" stroke-linecap="round" opacity=".45" fill="none" /><g class="clapper"><circle cx="100" cy="156" r="10" fill={gold} /></g></g>,
    sash: <g><path class="band" d="M30 44 L52 30 L170 150 L148 164 Z" fill="#5e1b3c" stroke={gold} stroke-width="3" /><g class="medal"><path d="M88 74 L112 74 L106 104 L94 104 Z" fill="#5e1b3c" stroke={gold} stroke-width="2" /><circle cx="100" cy="122" r="22" fill={gold} /><path d="M100 106 l5 10 11 1 -8 8 2 11 -10 -6 -10 6 2 -11 -8 -8 11 -1z" fill="#5e1b3c" /></g></g>,
    map: <g><path d={coast} fill="#2d1b24" stroke={gold} stroke-width="2.5" /><path d="M104 56 C96 92 110 124 100 160" stroke={gold} stroke-dasharray="5 6" stroke-width="2" fill="none" class="border" /><circle cx="56" cy="122" r="4" fill={gold} /><circle cx="146" cy="96" r="5" fill="#e05a4a" /><g class="arrow-g"><path class="arrow" pathLength={1} d="M52 128 C76 126 100 116 132 100" stroke="#e05a4a" stroke-width="8" fill="none" stroke-linecap="round" /><path class="arrowhead" d="M122 88 L144 96 L130 114 Z" fill="#e05a4a" /></g><g class="arrow-g a2"><path class="arrow" pathLength={1} d="M60 150 C86 146 108 138 132 126" stroke="#e05a4a" stroke-width="5" fill="none" stroke-linecap="round" opacity=".7" /></g></g>,
    mapin: <g><path d={coast} fill="#2d1b24" stroke={gold} stroke-width="2.5" /><path d="M104 56 C96 92 110 124 100 160" stroke={gold} stroke-dasharray="5 6" stroke-width="2" fill="none" class="border" /><circle cx="56" cy="122" r="5" fill={gold} /><g class="arrow-g"><path class="arrow" pathLength={1} d="M164 92 C138 98 108 108 76 122" stroke="#e05a4a" stroke-width="8" fill="none" stroke-linecap="round" /><path class="arrowhead" d="M84 108 L62 126 L86 136 Z" fill="#e05a4a" /></g></g>,
    march: <g><path d="M10 160 H190" stroke={gold} stroke-width="2" opacity=".5" /><g class="column">{[0, 1, 2, 3].map((i) => <g transform={`translate(${26 + i * 36} 0)`}><g class="soldier" style={{ animationDelay: `${i * 0.12}s` }}><circle cx="10" cy="88" r="8" fill={gold} /><path d="M2 80 h16 l-2 -8 h-12 z" fill={gold} /><path d="M10 98 V128" stroke={gold} stroke-width="8" stroke-linecap="round" /><path d="M10 128 l-8 28 M10 128 l8 28" stroke={gold} stroke-width="6" stroke-linecap="round" /><path d="M20 104 V62" stroke={gold} stroke-width="3" stroke-linecap="round" /></g></g>)}</g><g class="pennant"><path d="M176 58 V158" stroke={gold} stroke-width="3" /><path d="M177 60 l-28 11 28 11 z" fill="#c0392b" /></g></g>,
    cannon: <g><g class="carriage"><g class="barrel"><path d="M36 92 L142 84 Q150 84 150 92 L150 104 Q150 112 142 112 L36 108 Q28 100 36 92 Z" fill={gold} /><rect x="138" y="82" width="14" height="32" rx="4" fill={gold} /><path d="M50 96 L136 90" stroke="#fff4d0" stroke-width="3" opacity=".5" /></g><circle cx="78" cy="132" r="26" fill="none" stroke={gold} stroke-width="6" /><g class="spokes"><path d="M78 108 V156 M54 132 H102 M61 115 L95 149 M95 115 L61 149" stroke={gold} stroke-width="3" /></g><circle cx="78" cy="132" r="6" fill={gold} /></g><g class="puff"><circle cx="166" cy="96" r="14" fill="#efe3cf" /><circle cx="178" cy="86" r="10" fill="#efe3cf" /><circle cx="180" cy="104" r="8" fill="#efe3cf" /></g></g>,
    horse: <g class="gallop"><path d="M58 154 C46 92 62 52 100 46 C138 52 154 92 142 154 L120 154 C128 100 120 76 100 72 C80 76 72 100 80 154 Z" fill={gold} />{[[64, 80], [60, 108], [62, 136], [136, 80], [140, 108], [138, 136]].map(([x, y]) => <circle cx={x} cy={y} r="3.5" fill="#3b0f25" />)}</g>,
    ship: <g><g class="bob"><path d="M24 118 H176 L156 150 H44 Z" fill="#2d1b24" stroke={gold} stroke-width="3" /><rect x="66" y="94" width="68" height="24" fill="#2d1b24" stroke={gold} stroke-width="3" /><rect x="84" y="62" width="12" height="32" fill={gold} /><rect x="106" y="70" width="10" height="24" fill={gold} /><path d="M40 132 H160" stroke={gold} stroke-width="2" stroke-dasharray="2 8" /><g class="smoke"><circle cx="90" cy="50" r="9" fill="#cfc3b3" opacity=".8" /><circle cx="100" cy="38" r="12" fill="#cfc3b3" opacity=".6" /></g></g><g class="waves"><path d="M-30 162 q15 -9 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0" stroke={gold} stroke-width="3" fill="none" /></g></g>,
    airship: <g class="float"><ellipse cx="100" cy="80" rx="74" ry="30" fill={`url(#${id}-env)`} stroke={gold} stroke-width="2.5" /><path d="M36 80 H164 M56 60 C80 70 120 70 144 60 M56 100 C80 90 120 90 144 100" stroke={gold} stroke-width="1.5" opacity=".6" fill="none" /><path d="M168 80 l18 -16 v32 z" fill={gold} /><path d="M80 108 L74 130 H126 L120 108" fill="#2d1b24" stroke={gold} stroke-width="2.5" /><g class="prop"><path d="M60 119 V129" stroke={gold} stroke-width="3" /></g></g>,
    fort: <g><g class="build"><path d="M36 160 V92 h18 v12 h16 v-12 h18 v12 h16 v-12 h18 v12 h16 v-12 h18 V160 Z" fill={`url(#${id}-stone)`} stroke={gold} stroke-width="2.5" /><path d="M90 160 v-28 a10 10 0 0 1 20 0 v28" fill="#12070d" /><path d="M36 124 H164 M36 142 H164" stroke={gold} stroke-width="1" opacity=".35" /></g><g class="raise"><path d="M100 92 V44" stroke={gold} stroke-width="3" /><g class="pennant"><path d="M101 46 l26 10 -26 10 z" fill="#c0392b" /></g></g></g>,
    certificate: <g><g class="paper"><rect x="28" y="50" width="144" height="104" rx="4" fill="#f4e6cc" stroke={gold} stroke-width="4" /><rect x="38" y="60" width="124" height="84" fill="none" stroke={gold} stroke-width="1.5" /><text x="100" y="88" text-anchor="middle" font-size="12" fill="#5e1b3c" font-family="Gloock, serif" letter-spacing="2.5">SHARE CERTIFICATE</text><path d="M58 104 H142 M68 118 H132" stroke="#b49c74" stroke-width="2" /></g><g class="stamp"><circle cx="146" cy="138" r="20" fill={`url(#${id}-wax)`} /><text x="146" y="145" text-anchor="middle" font-size="18" fill="#f2b8a6" font-family="Gloock, serif">✠</text></g></g>,
    flag: <g><path d="M60 172 V30" stroke={gold} stroke-width="5" stroke-linecap="round" /><circle cx="60" cy="26" r="6" fill={gold} /><g class="rise"><g class="cloth"><path d="M62 34 C90 24 112 46 152 36 V88 C112 98 90 76 62 86 Z" fill="#5e1b3c" stroke={gold} stroke-width="2" /><text x="106" y="70" text-anchor="middle" font-size="28" fill={gold} font-family="Gloock, serif">✠</text></g></g></g>,
    coins: <g><path d="M46 122 H154 V162 H46 Z" fill="#3b2412" stroke={gold} stroke-width="3" /><path d="M46 122 L56 104 H144 L154 122" fill="#4e3018" stroke={gold} stroke-width="3" /><rect x="92" y="130" width="16" height="12" rx="2" fill={gold} />{[0, 1, 2, 3, 4, 5, 6].map((i) => <g class="coin" style={{ animationDelay: `${0.3 + i * 0.22}s` }}><circle cx={74 + (i % 4) * 17} cy="40" r="11" fill={gold} stroke="#8c6a1e" stroke-width="1.5" /><circle cx={74 + (i % 4) * 17} cy="40" r="6" fill="none" stroke="#8c6a1e" stroke-width="1" /></g>)}</g>,
    oath: <g><g class="book"><path d="M100 64 C80 52 52 52 30 60 V150 C52 142 80 142 100 154 Z" fill="#f4e6cc" stroke={gold} stroke-width="3" /><path d="M100 64 C120 52 148 52 170 60 V150 C148 142 120 142 100 154 Z" fill="#efdfc2" stroke={gold} stroke-width="3" /><path d="M44 82 C60 77 76 77 90 82 M44 98 C60 93 76 93 90 98 M44 114 C60 109 76 109 90 114 M110 82 C124 77 140 77 156 82 M110 98 C124 93 140 93 156 98" stroke="#b49c74" stroke-width="2.5" fill="none" /><path d="M126 104 h26 v40 l-13 -9 -13 9 z" fill="#5e1b3c" /></g><g class="hand"><path d="M88 132 V92 a6 6 0 0 1 12 0 V120 V84 a6 6 0 0 1 12 0 V120 V88 a6 6 0 0 1 12 0 V122 V100 a6 6 0 0 1 12 0 V140 C136 162 120 172 104 172 C92 172 82 164 76 152 L66 132 a6 6 0 0 1 10 -6 Z" fill={gold} stroke="#8c6a1e" stroke-width="1.5" /></g></g>,
    eye: <g><path class="draw" pathLength={1} {...line} d="M25 100 C60 50 140 50 175 100 C140 150 60 150 25 100 Z" /><circle class="jewel" cx="100" cy="100" r="22" fill="#c0392b" stroke={gold} stroke-width="3" /></g>
  };
  return (
    <svg class={'cer-emblem cer-e-' + e} viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <linearGradient id={id + '-gold'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFEBB0" /><stop offset=".45" stop-color="#E3BA55" /><stop offset="1" stop-color="#9C7424" /></linearGradient>
        <linearGradient id={id + '-steel'} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FAF7F0" /><stop offset=".5" stop-color="#C9CFD6" /><stop offset="1" stop-color="#7D8793" /></linearGradient>
        <radialGradient id={id + '-wax'} cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#d23a48" /><stop offset=".6" stop-color="#9b1b2a" /><stop offset="1" stop-color="#5e0f18" /></radialGradient>
        <linearGradient id={id + '-env'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a2a50" /><stop offset="1" stop-color="#3b0f25" /></linearGradient>
        <linearGradient id={id + '-stone'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a4636" /><stop offset="1" stop-color="#2d1f16" /></linearGradient>
      </defs>
      {body[e] || body.seal}
    </svg>
  );
}

export function Scene({ w, fx }: { w: any; fx: any }) {
  const s = scene(w, fx);
  return (
    <div class={'cer-scene cer-k-' + fx.k + (s.tone ? ' tone-' + s.tone : '')}>
      <div class="cer-rays" />
      <div class="cer-glow" />
      <div class="cer-sparks">{Array.from({ length: 22 }, (_, i) => <i style={{ left: `${(i * 37 + 11) % 100}%`, animationDelay: `${0.6 + ((i * 7) % 11) * 0.28}s`, animationDuration: `${3.4 + (i % 5) * 0.5}s`, width: `${2 + (i % 3)}px`, height: `${2 + (i % 3)}px` }} />)}</div>
      <div class="cer-grain" />
      <Emblem e={s.emblem} />
      <div class="cer-kicker">{s.kicker}</div>
      <div class="cer-name"><span>{s.name}</span></div>
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
  const [leaving, setLeaving] = useState(false);
  const fx = queue[0];
  // on to the next scene; after the last, the overlay fades away rather than vanishing
  const next = () => {
    if (queue.length > 1) return (setQueue((q) => q.slice(1)), setN((x) => x + 1));
    setLeaving(true);
    setTimeout(() => (setQueue([]), setLeaving(false), setN((x) => x + 1)), 350);
  };
  useEffect(() => {
    if (!fx || (window as any).__realmCerHold) return;
    const t = setTimeout(next, LONG);
    return () => clearTimeout(t);
  }, [fx, n, queue.length]);
  if (!fx || !w) return null;
  return (
    <div class={'cer' + (leaving ? ' leaving' : '')} role="dialog" aria-label="A ceremony" onClick={next}>
      <Scene key={n} w={w} fx={fx} />
      <div class="cer-bar" onClick={(e) => e.stopPropagation()}>
        {queue.length > 1 && <span class="cer-count">{queue.length - 1} more</span>}
        <button onClick={next}>{queue.length > 1 ? 'Next' : 'Close'}</button>
        {queue.length > 1 && <button onClick={() => (setQueue((q) => q.slice(0, 1)), setLeaving(true), setTimeout(() => (setQueue([]), setLeaving(false)), 350))}>Skip all</button>}
        <button onClick={() => (setFxOff(true), setLeaving(true), setTimeout(() => (setQueue([]), setLeaving(false)), 350))}>Turn off</button>
      </div>
    </div>
  );
}
