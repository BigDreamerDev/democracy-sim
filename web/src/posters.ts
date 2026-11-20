// Wartime posters: original designs in the manner of the great recruiting, war-loan and home-front posters of 1914–45,
// drawn as SVG. Every name comes from the live world: the sovereign, the General, the Imperial High Commissioner, the
// enemy, the realm, its provinces and its last war. Each design has its own typeface and palette; the war room lets a
// reader try others. The enemy has its own posters (signed by the defectors at its court); the High Commission can
// commission one with its own slogan; under a regime, resisters scrawl on them. Used by the war room (atlas.tsx), the
// Gazette, the commissioned-poster banner, and saved as PNGs (fonts embedded).
import { nm, holderOf, realmPlace, inForce } from '../../engine/index';
import { highCommission } from '../../engine/empire';
import { BOND_PAYS } from '../../engine/war';
import { PROVINCES, PROFILES } from '../../engine/foreign';

// ---------------------------------------------------------------- the type case
// k: average width of a capital as a share of the font size (a first guess; fitPosters() measures for real)
export const FONTS: Record<string, { label: string; family: string; weight: number; caps: boolean; k: number }> = {
  imperial: { label: 'Imperial (Cinzel)', family: "Cinzel, 'Trajan Pro', Georgia, serif", weight: 900, caps: true, k: 0.82 },
  propaganda: { label: 'Propaganda (Bebas Neue)', family: "'Bebas Neue', Oswald, Impact, sans-serif", weight: 400, caps: true, k: 0.42 },
  condensed: { label: 'Bulletin (Oswald)', family: "Oswald, 'Bebas Neue', Impact, sans-serif", weight: 700, caps: true, k: 0.56 },
  gothic: { label: 'Gothic (Unifraktur)', family: "'UnifrakturMaguntia', 'Old English Text MT', serif", weight: 400, caps: false, k: 0.56 },
  fatface: { label: 'Fat face (Abril)', family: "'Abril Fatface', Georgia, serif", weight: 400, caps: true, k: 0.74 },
  slab: { label: 'Slab (Alfa Slab)', family: "'Alfa Slab One', Rockwell, Georgia, serif", weight: 400, caps: true, k: 0.8 },
  classic: { label: 'Gazette (Gloock)', family: "Gloock, Georgia, 'Times New Roman', serif", weight: 400, caps: true, k: 0.72 }
};
export const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Bebas+Neue&family=Oswald:wght@500;700&family=UnifrakturMaguntia&family=Abril+Fatface&family=Alfa+Slab+One&family=Permanent+Marker&family=Atkinson+Hyperlegible:wght@400;700&family=Gloock&display=swap';
const SANS = "'Atkinson Hyperlegible', Oswald, Arial, sans-serif";
const MARKER = "'Permanent Marker', 'Comic Sans MS', cursive";

// ---------------------------------------------------------------- the inks
export type Pal = { bg: string; paper: string; deep: string; mid: string; gold: string; light: string; ink: string; skin: string; shade: string };
export const PALETTES: Record<string, { label: string } & Pal> = {
  porphyry: { label: 'Porphyry and gold', bg: '#4A1430', paper: '#F1E6CC', deep: '#4A1430', mid: '#7A1F45', gold: '#C9A13B', light: '#F6EBDC', ink: '#22080F', skin: '#E9C9A6', shade: '#C99C78' },
  khaki: { label: 'Khaki and blood', bg: '#E8DDBF', paper: '#E8DDBF', deep: '#4B4A2C', mid: '#A8261D', gold: '#C79A2E', light: '#F4EDD8', ink: '#1E1B12', skin: '#E2BC94', shade: '#B88C66' },
  navy: { label: 'Navy and brass', bg: '#14233A', paper: '#EDE6D2', deep: '#14233A', mid: '#2F5A82', gold: '#D2A847', light: '#F3EEDF', ink: '#0A1220', skin: '#E6C4A0', shade: '#BF9670' },
  blood: { label: 'Black and crimson', bg: '#151112', paper: '#EFE4D0', deep: '#151112', mid: '#B2171C', gold: '#D9B24C', light: '#F5ECDD', ink: '#0B0909', skin: '#E3C09E', shade: '#B88E6C' },
  realm: { label: 'Ink and teal', bg: '#1F3B4A', paper: '#F3EBDD', deep: '#1F3B4A', mid: '#A3322B', gold: '#C08A2E', light: '#F7F1E5', ink: '#141414', skin: '#E8C8A4', shade: '#C29A76' },
  steel: { label: 'Steel and orange', bg: '#2B2F33', paper: '#E4E1D8', deep: '#2B2F33', mid: '#D2601A', gold: '#E2B04A', light: '#F1EEE6', ink: '#111315', skin: '#E2BE9A', shade: '#B88E6A' }
};
export type Theme = { pal: Pal; font: string };

// ---------------------------------------------------------------- the world, for the posters
export type PosterData = { enemyId: string | null; lastWarId: string | null; nations: Record<string, string>; kessHeld: boolean; one: string; many: string; place: string; imperial: boolean; sovereign: string | null; sovTitle: string; general: string | null; hc: string | null; enemy: string | null; lastWar: string | null; province: string | null; victory: number };
export function posterData(w: any): PosterData {
  const hos = w.hos?.holder;
  const gen = holderOf(w, 'army');
  const hc = highCommission(w)?.holder;
  const held = Object.keys(w.provinces || {}).find((id) => w.provinces[id].owner === 'realm');
  // the realm's money by its current name (a law can rename the crown: marks, ducats…)
  const cur = w.config?.currency;
  return {
    enemyId: w.army?.war || null,
    lastWarId: w.wars?.[0]?.nation || null,
    nations: Object.fromEntries(Object.values(w.nations || {}).map((n: any) => [n.id, n.name])),
    kessHeld: w.provinces?.kessvale?.owner === 'realm',
    one: cur?.one || 'crown',
    many: cur?.many || 'crowns',
    place: realmPlace(w),
    imperial: inForce(w, 'imperial'),
    sovereign: hos ? nm(w, hos) : null,
    sovTitle: w.config?.hos === 'monarchy' ? w.config.hosTitle : 'President',
    general: gen ? nm(w, gen) : null,
    hc: hc ? nm(w, hc) : null,
    enemy: w.army?.war ? w.nations[w.army.war]?.name ?? null : null,
    lastWar: w.wars?.[0] ? w.nations[w.wars[0].nation]?.name ?? null : null,
    province: held ? PROVINCES[held]?.name ?? null : null,
    victory: Math.round(BOND_PAYS.victory * 100)
  };
}
const realmWord = (d: PosterData) => (d.imperial ? 'Empire' : 'Realm');
const sovLine = (d: PosterData) => (d.sovereign ? (d.sovereign.toLowerCase().startsWith(d.sovTitle.toLowerCase()) ? d.sovereign : `${d.sovTitle} ${d.sovereign}`) : `The ${realmWord(d)}`);
const bare = (s: string | null, title: string) => (s ? s.replace(new RegExp('^' + title + '\\s+', 'i'), '') : null);

// ---------------------------------------------------------------- type
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
type TOpt = { f?: 'H' | 'S' | 'M'; anchor?: 'start' | 'middle' | 'end'; spacing?: number; weight?: number; rotate?: number; italic?: boolean };
// one line of type that knows how wide it may be (data-max): fitPosters() shrinks it in the browser if it would overflow
function T(t: Theme, x: number, y: number, s: string, size: number, max: number, fill: string, o: TOpt = {}) {
  const f = o.f ?? 'H';
  const font = FONTS[t.font] ?? FONTS.classic;
  const str = f === 'H' && font.caps ? s.toUpperCase() : s;
  const caps = str === str.toUpperCase() && /[A-Z]/.test(str);
  const k = f === 'H' ? font.k * (caps ? 1 : 0.78) : f === 'M' ? 0.62 : caps ? 0.68 : 0.52;
  const fit = Math.max(8, Math.min(size, Math.floor(max / Math.max(1, str.length * k + ((o.spacing ?? 0) * str.length) / size))));
  const fam = f === 'H' ? font.family : f === 'M' ? MARKER : SANS;
  const wt = o.weight ?? (f === 'H' ? font.weight : 400);
  return `<text data-max="${max}" x="${x}" y="${y}" font-size="${fit}" fill="${fill}" text-anchor="${o.anchor ?? 'middle'}" font-family="${esc(fam)}" font-weight="${wt}"${o.spacing ? ` letter-spacing="${o.spacing}"` : ''}${o.italic ? ' font-style="italic"' : ''}${o.rotate ? ` transform="rotate(${o.rotate} ${x} ${y})"` : ''}>${esc(str)}</text>`;
}

// ---------------------------------------------------------------- the engraver's shapes
const crown = (cx: number, cy: number, s: number, fill: string, jewel = '#B2171C') =>
  `<g transform="translate(${cx - 50 * s} ${cy - 45 * s}) scale(${s})"><path d="M6 70 L0 18 L26 42 L50 2 L74 42 L100 18 L94 70 Z" fill="${fill}"/><rect x="4" y="72" width="92" height="14" rx="2" fill="${fill}"/><circle cx="0" cy="16" r="6" fill="${fill}"/><circle cx="50" cy="2" r="7" fill="${fill}"/><circle cx="100" cy="16" r="6" fill="${fill}"/><circle cx="50" cy="79" r="4.5" fill="${jewel}"/><circle cx="26" cy="79" r="3.5" fill="${jewel}"/><circle cx="74" cy="79" r="3.5" fill="${jewel}"/><path d="M50 30 L56 50 L50 62 L44 50 Z" fill="${jewel}"/></g>`;
const rays = (cx: number, cy: number, n: number, fill: string, len = 1200, phase = 0) => {
  let p = '';
  for (let i = 0; i < n; i++) {
    const a1 = ((i + phase) / n) * Math.PI * 2, a2 = ((i + phase + 0.5) / n) * Math.PI * 2;
    p += `M${cx} ${cy}L${(cx + Math.cos(a1) * len).toFixed(0)} ${(cy + Math.sin(a1) * len).toFixed(0)}L${(cx + Math.cos(a2) * len).toFixed(0)} ${(cy + Math.sin(a2) * len).toFixed(0)}Z`;
  }
  return `<path d="${p}" fill="${fill}"/>`;
};
const laurel = (cx: number, cy: number, r: number, fill: string, open = 0.35) => {
  let out = '';
  for (let side = -1; side <= 1; side += 2)
    for (let i = 0; i < 11; i++) {
      const a = Math.PI / 2 + side * (open + i * 0.22);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      const rot = (a * 180) / Math.PI + (side > 0 ? 125 : 55);
      out += `<path d="M0 0 Q${(r * 0.09).toFixed(1)} -${(r * 0.05).toFixed(1)} ${(r * 0.17).toFixed(1)} 0 Q${(r * 0.09).toFixed(1)} ${(r * 0.05).toFixed(1)} 0 0Z" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)})" fill="${fill}"/>`;
    }
  return out;
};
// a ribbon banner with its tails folded behind
const ribbon = (t: Theme, cx: number, cy: number, w: number, h: number, fill: string, back: string, textFill: string, s: string, size: number) =>
  `<path d="M${cx - w / 2 - h * 0.9} ${cy - h * 0.2} h${h * 1.1} v${h} h-${h * 1.1} l${h * 0.4} -${h / 2} Z" fill="${back}"/><path d="M${cx + w / 2 + h * 0.9} ${cy - h * 0.2} h-${h * 1.1} v${h} h${h * 1.1} l-${h * 0.4} -${h / 2} Z" fill="${back}"/><rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" fill="${fill}"/>${T(t, cx, cy + size * 0.36, s, size, w - 24, textFill, { f: 'S', weight: 700, spacing: 2 })}`;
// the imperial double-headed eagle: two crowned heads looking outward, fanned wings, sword and orb
function eagle(cx: number, cy: number, s: number, fill: string, accent: string) {
  let g = '';
  for (const side of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const ang = -80 + i * 13, len = 168 - i * 8;
      g += `<path d="M0 -10 L${len} -7 L${len + 26} 0 L${len} 7 L0 10 Z" fill="${fill}" transform="translate(${side * 28} -22) scale(${side} 1) rotate(${ang})"/>`;
    }
    g += `<path d="M${side * 16} -58 Q${side * 104} -118 ${side * 146} -64 Q${side * 118} -24 ${side * 28} 12 Z" fill="${fill}"/>`;
    g += `<path d="M${side * 8} -48 Q${side * 16} -100 ${side * 42} -114 L${side * 58} -102 Q${side * 34} -90 ${side * 28} -40 Z" fill="${fill}"/>`;
    g += `<circle cx="${side * 50}" cy="-114" r="17" fill="${fill}"/>`;
    g += `<path d="M${side * 63} -121 L${side * 92} -110 L${side * 64} -101 Z" fill="${accent}"/>`;
    g += `<circle cx="${side * 54}" cy="-118" r="3.6" fill="${accent}"/>`;
    g += `<path d="M${side * 38} -129 l${side * 5} -15 l${side * 6} 10 l${side * 6} -12 l${side * 5} 17 Z" fill="${accent}"/>`;
  }
  for (let i = 0; i < 5; i++) g += `<path d="M0 -8 L84 -6 L100 0 L84 6 L0 8 Z" fill="${fill}" transform="translate(0 60) rotate(${62 + i * 14})"/>`;
  g += `<path d="M-36 -40 Q0 -70 36 -40 L30 64 Q0 84 -30 64 Z" fill="${fill}"/><path d="M-24 -26 L24 -26 L20 40 Q0 56 -20 40 Z" fill="${accent}"/><path d="M-24 -26 L24 -26 L20 40 Q0 56 -20 40 Z" fill="none" stroke="${fill}" stroke-width="4"/><path d="M0 -20 V40 M-16 2 H16" stroke="${fill}" stroke-width="6"/>`;
  g += `<path d="M58 66 L122 -44 L128 -40 L64 70 Z" fill="${accent}"/><path d="M50 58 L74 72" stroke="${accent}" stroke-width="8" stroke-linecap="round"/>`;
  g += `<circle cx="-80" cy="76" r="18" fill="${accent}"/><path d="M-80 52 V62 M-86 56 H-74" stroke="${accent}" stroke-width="4"/>`;
  return `<g transform="translate(${cx} ${cy}) scale(${s})">${g}${crown(0, -168, 0.6, accent, fill)}</g>`;
}
// an infantryman in greatcoat and steel helmet, rifle at the slope or bayonet levelled
const soldier = (x: number, y: number, s: number, fill: string, charge = false) =>
  `<g transform="translate(${x} ${y}) scale(${s})" fill="${fill}"><path d="M-14 -88 Q0 -104 14 -88 L18 -84 H-18 Z"/><circle cx="0" cy="-78" r="9"/><path d="M-16 -66 L16 -66 L22 -6 L10 -6 L8 30 L2 30 L0 -2 L-2 30 L-8 30 L-10 -6 L-22 -6 Z"/>${charge ? '<path d="M8 -50 L74 -64 L76 -60 L10 -44 Z"/><path d="M74 -64 L98 -69 L76 -60 Z"/>' : '<path d="M10 -64 L20 -140 L24 -139 L15 -62 Z"/><path d="M20 -140 L23 -162 L24 -139 Z"/>'}</g>`;
const barbed = (y: number, w: number, fill: string) => {
  let p = `<path d="M24 ${y} ` + Array.from({ length: Math.ceil(w / 24) }, (_, i) => `Q${36 + i * 24} ${y - 14} ${48 + i * 24} ${y}`).join(' ') + `" stroke="${fill}" stroke-width="3" fill="none"/>`;
  for (let i = 0; i < w / 24; i++) p += `<path d="M${40 + i * 24} ${y - 12} l8 10 m0 -10 l-8 10" stroke="${fill}" stroke-width="2.5"/>`;
  for (let i = 0; i < 5; i++) p += `<rect x="${60 + i * 120}" y="${y - 30}" width="6" height="44" fill="${fill}" transform="rotate(${i % 2 ? 8 : -8} ${63 + i * 120} ${y})"/>`;
  return p;
};
const smoke = (x: number, y: number, s: number, fill: string, op = 0.9) =>
  `<g transform="translate(${x} ${y}) scale(${s})" fill="${fill}" opacity="${op}"><circle cx="0" cy="0" r="22"/><circle cx="24" cy="-14" r="26"/><circle cx="52" cy="-6" r="20"/><circle cx="70" cy="-28" r="24"/><circle cx="98" cy="-20" r="18"/></g>`;
const waves = (y: number, fill: string, amp = 10, step = 40, off = 0) =>
  `<path d="M0 ${y} ` + Array.from({ length: 18 }, () => `q${step / 2} -${amp} ${step} 0`).join(' ') + ` V900 H0 Z" fill="${fill}" transform="translate(${off} 0)"/>`;
const star = (cx: number, cy: number, r: number, fill: string) => {
  const p = Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.42 : r; return `${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`; });
  return `<path d="M${p.join('L')}Z" fill="${fill}"/>`;
};
const halftone = (id: string, fill: string, size = 8) => `<pattern id="${id}" width="${size}" height="${size}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.28}" fill="${fill}"/></pattern>`;

// ---------------------------------------------------------------- the press: paper, frame, grain, graffiti
export type Scrawl = { text: string; at?: number };
function press(t: Theme, art: string, o: { framed?: boolean; frameColor?: string; graffiti?: Scrawl[]; id: string }) {
  const p = t.pal;
  const fc = o.frameColor ?? p.ink;
  const g = (o.graffiti || []).slice(0, 3).map((x, i) => {
    const y = [300, 520, 700][i], rot = [-12, 9, -6][i];
    return `<g opacity="0.92">${T(t, 300, y, x.text, 54, 470, '#C21A1A', { f: 'M', rotate: rot })}</g>`;
  }).join('');
  const uid = o.id.replace(/[^a-z0-9]/gi, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900" width="600" height="900" data-poster="${esc(o.id)}">
  <defs>
    <filter id="grain-${uid}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7"/><feColorMatrix type="matrix" values="0 0 0 0 0.25  0 0 0 0 0.2  0 0 0 0 0.12  0 0 0 0.22 0"/></filter>
    <radialGradient id="vig-${uid}" cx="50%" cy="45%" r="75%"><stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.32"/></radialGradient>
    ${halftone('ht-' + uid, 'rgba(0,0,0,0.18)')}
    <clipPath id="clip-${uid}"><rect x="24" y="24" width="552" height="852"/></clipPath>
  </defs>
  <rect width="600" height="900" fill="${p.paper}"/>
  <g clip-path="url(#clip-${uid})">${art.replace(/HT_ID/g, 'ht-' + uid)}</g>
  <rect width="600" height="900" fill="url(#vig-${uid})"/>
  <rect width="600" height="900" filter="url(#grain-${uid})"/>
  ${o.framed === false ? '' : `<rect x="12" y="12" width="576" height="876" fill="none" stroke="${p.paper}" stroke-width="14"/><rect x="18" y="18" width="564" height="864" fill="none" stroke="${fc}" stroke-width="3"/><rect x="25" y="25" width="550" height="850" fill="none" stroke="${fc}" stroke-width="1.2"/>`}
  ${g}
</svg>`;
}

// ---------------------------------------------------------------- the posters
export type PosterDef = { id: string; title: string; kind: 'enlist' | 'bonds' | 'home'; font: string; pal: string; art: (d: PosterData, t: Theme) => string; enemy?: boolean };

export const POSTERS: PosterDef[] = [
  {
    // the war loan, after the sunburst bond drives
    id: 'lend', title: 'Lend your crowns', kind: 'bonds', font: 'slab', pal: 'porphyry',
    art: (d, t) => { const p = t.pal; return `
      <rect width="600" height="900" fill="${p.deep}"/>
      ${rays(300, 450, 44, p.mid, 900)}
      <circle cx="300" cy="450" r="176" fill="${p.ink}" opacity="0.35"/>
      <circle cx="300" cy="444" r="170" fill="${p.gold}"/><circle cx="300" cy="444" r="152" fill="none" stroke="${p.deep}" stroke-width="5"/><circle cx="300" cy="444" r="140" fill="none" stroke="${p.deep}" stroke-width="1.5" stroke-dasharray="3 5"/>
      ${laurel(300, 452, 118, p.deep, 0.5)}
      ${crown(300, 384, 0.62, p.deep, p.mid)}
      ${T(t, 300, 486, `${d.victory}%`, 80, 200, p.deep)}
      ${T(t, 300, 518, 'on victory', 18, 180, p.deep, { f: 'S', weight: 700, spacing: 4 })}
      ${T(t, 300, 120, 'Lend your', 72, 520, p.light)}
      ${T(t, 300, 210, d.many, 104, 520, p.gold)}
      ${ribbon(t, 300, 676, 400, 54, p.light, p.gold, p.deep, `Buy ${d.imperial ? 'Imperial ' : ''}War Bonds`, 28)}
      ${T(t, 300, 760, d.enemy ? `and put an end to ${d.enemy}` : 'and keep the peace you paid for', 26, 500, p.gold, { f: 'S', weight: 700 })}
      ${T(t, 300, 824, d.hc ? `By order of Imperial High Commissioner ${d.hc}` : `By order of ${sovLine(d)}`, 19, 500, p.light, { f: 'S' })}
      ${T(t, 300, 856, `The ${realmWord(d)} repays every ${d.one}`, 16, 460, p.gold, { f: 'S', spacing: 3 })}`; }
  },
  {
    // the column on the march, the General with the standard at its head
    id: 'march', title: 'March with the General', kind: 'enlist', font: 'propaganda', pal: 'khaki',
    art: (d, t) => { const p = t.pal;
      let men = '';
      for (let r = 0; r < 4; r++) for (let i = 0; i < 8; i++) men += soldier(40 + i * 72 + r * 18, 560 + r * 70, 0.62 + r * 0.12, p.ink);
      return `
      <rect width="600" height="900" fill="${p.paper}"/>
      <rect x="0" y="0" width="600" height="440" fill="${p.mid}"/>
      ${rays(300, 440, 30, p.deep, 800)}
      <circle cx="300" cy="440" r="130" fill="${p.gold}"/>
      <rect x="0" y="436" width="600" height="8" fill="${p.ink}"/>
      <path d="M0 444 H600 V900 H0 Z" fill="url(#HT_ID)"/>
      <rect x="290" y="250" width="6" height="200" fill="${p.ink}"/>
      <path d="M296 256 L420 270 Q392 300 420 330 L296 318 Z" fill="${p.light}"/>
      ${eagle(350, 296, 0.17, p.mid, p.gold)}
      ${men}
      ${T(t, 300, 112, d.general ? `General ${bare(d.general, 'general')}` : `The ${realmWord(d)}'s Army`, 74, 520, p.light, { spacing: 2 })}
      ${T(t, 300, 206, 'marches.', 112, 520, p.gold, { spacing: 3 })}
      ${T(t, 160, 300, 'March', 70, 240, p.light)}
      ${T(t, 160, 368, d.general ? 'with him.' : 'with it.', 60, 240, p.light)}
      <rect x="40" y="802" width="520" height="62" fill="${p.ink}"/>
      ${T(t, 300, 832, 'Every volunteer is half a regiment', 26, 500, p.gold, { f: 'S', weight: 700, spacing: 2 })}
      ${T(t, 300, 856, d.enemy ? `The front with ${d.enemy} is waiting. Enlist today.` : 'Enlist at the War Room today.', 17, 500, p.light, { f: 'S' })}`; }
  },
  {
    // the guns, after the munitions appeals: crowns become shells
    id: 'cannon', title: 'Every crown a cannon', kind: 'bonds', font: 'slab', pal: 'steel',
    art: (d, t) => { const p = t.pal; return `
      <rect width="600" height="900" fill="${p.paper}"/>
      <path d="M0 520 L600 420 V900 H0 Z" fill="${p.deep}"/>
      <path d="M0 520 L600 420 V900 H0 Z" fill="url(#HT_ID)"/>
      ${smoke(330, 268, 1.6, p.light, 0.9)}${smoke(250, 300, 1.1, p.paper, 0.8)}
      ${star(486, 300, 70, p.gold)}${star(486, 300, 38, p.mid)}
      <g fill="${p.ink}"><rect x="160" y="380" width="330" height="54" rx="10" transform="rotate(-20 330 410)"/><rect x="430" y="300" width="40" height="66" rx="8" transform="rotate(-20 450 333)"/><path d="M120 470 L250 430 L270 500 L150 540 Z"/><rect x="80" y="520" width="240" height="20" rx="8" transform="rotate(14 200 530)"/></g>
      <circle cx="200" cy="520" r="84" fill="none" stroke="${p.gold}" stroke-width="16"/><circle cx="200" cy="520" r="16" fill="${p.gold}"/>
      ${Array.from({ length: 8 }, (_, i) => `<rect x="196" y="440" width="8" height="160" fill="${p.gold}" transform="rotate(${i * 22.5} 200 520)"/>`).join('')}
      ${Array.from({ length: 5 }, (_, i) => `<g transform="translate(${370 + i * 34} 560)"><rect x="0" y="0" width="24" height="64" rx="3" fill="${p.gold}"/><path d="M0 0 Q12 -30 24 0 Z" fill="${p.mid}"/><rect x="0" y="48" width="24" height="6" fill="${p.ink}"/></g>`).join('')}
      ${T(t, 300, 118, `Every ${d.one}`, 82, 530, p.ink)}
      ${T(t, 300, 212, 'a cannon', 104, 530, p.mid)}
      ${T(t, 300, 708, 'Buy war bonds. Fill the war chest.', 30, 500, p.light, { f: 'S', weight: 700 })}
      ${T(t, 300, 770, d.hc ? `Imperial High Commissioner ${d.hc}` : `${sovLine(d)} asks it of you`, 26, 500, p.gold)}
      ${T(t, 300, 848, `${d.victory}% repaid on victory`, 20, 460, p.light, { f: 'S', spacing: 3 })}`; }
  },
  {
    // the imperial appeal: laurel, crown and the eagle
    id: 'calls', title: 'The Empire calls', kind: 'enlist', font: 'imperial', pal: 'porphyry',
    art: (d, t) => { const p = t.pal; return `
      <rect width="600" height="900" fill="${p.deep}"/>
      <rect width="600" height="900" fill="url(#HT_ID)" opacity="0.6"/>
      ${T(t, 300, 104, `Daughters and sons of ${d.place}`, 30, 500, p.gold, { f: 'S', weight: 700, spacing: 3 })}
      <rect x="150" y="124" width="300" height="2" fill="${p.gold}"/>
      <circle cx="300" cy="400" r="196" fill="${p.mid}"/>
      ${laurel(300, 400, 214, p.gold, 0.3)}
      ${eagle(300, 430, 0.92, p.ink, p.gold)}
      ${T(t, 300, 690, `The ${realmWord(d)}`, 68, 520, p.light, { spacing: 4 })}
      ${T(t, 300, 780, 'calls', 104, 500, p.gold, { spacing: 8 })}
      ${T(t, 300, 824, 'Will you answer?', 26, 460, p.light, { f: 'S', weight: 700 })}
      ${T(t, 300, 858, sovLine(d), 22, 480, p.gold, { spacing: 3 })}`; }
  },
  {
    // the line holds, after the posters of the great sieges: wire, trench, defiance
    id: 'firm', title: 'They shall not pass', kind: 'enlist', font: 'fatface', pal: 'blood',
    art: (d, t) => { const p = t.pal; return `
      <rect width="600" height="900" fill="${p.mid}"/>
      ${rays(300, 980, 26, p.deep, 1200)}
      <circle cx="300" cy="660" r="150" fill="${p.gold}"/>
      ${soldier(170, 652, 1.05, p.ink, true)}${soldier(290, 660, 1.12, p.ink, true)}${soldier(410, 652, 1.05, p.ink, true)}
      <path d="M0 660 Q150 636 300 660 T600 652 V900 H0 Z" fill="${p.ink}"/>
      ${barbed(668, 600, p.light)}
      ${crown(300, 120, 0.8, p.gold, p.ink)}
      ${T(t, 300, 268, 'They', 112, 520, p.light)}
      ${T(t, 300, 372, 'shall not', 96, 520, p.gold)}
      ${T(t, 300, 494, 'pass', 128, 520, p.light)}
      ${T(t, 300, 740, d.enemy ? `${d.enemy}: the line holds` : 'The line holds', 28, 500, p.light, { f: 'S', weight: 700, spacing: 3 })}
      ${T(t, 300, 800, d.general ? `With General ${bare(d.general, 'general')} at the front` : 'The Army holds the line', 22, 500, p.gold, { f: 'S', weight: 700 })}
      ${T(t, 300, 846, `${sovLine(d)} is with you`, 20, 480, p.light, { f: 'S', spacing: 2 })}`; }
  },
  {
    // the eagle triptych, constructivist diagonal
    id: 'eagle', title: 'One Empire', kind: 'enlist', font: 'imperial', pal: 'blood',
    art: (d, t) => { const p = t.pal; return `
      <rect width="600" height="900" fill="${p.paper}"/>
      <path d="M0 260 L600 120 V560 L0 700 Z" fill="${p.mid}"/>
      <path d="M0 260 L600 120 V140 L0 280 Z" fill="${p.ink}"/><path d="M0 680 L600 540 V560 L0 700 Z" fill="${p.ink}"/>
      ${eagle(300, 440, 1.1, p.ink, p.gold)}
      ${T(t, 300, 118, `One ${realmWord(d)}`, 74, 520, p.ink, { spacing: 4 })}
      ${T(t, 300, 780, 'One crown', 66, 520, p.mid, { spacing: 4 })}
      ${T(t, 300, 852, 'One victory', 60, 520, p.ink, { spacing: 4 })}`; }
  },
  {
    // the fleet: an ironclad, searchlights and smoke
    id: 'waves', title: 'Rule the waves', kind: 'enlist', font: 'condensed', pal: 'navy',
    art: (d, t) => { const p = t.pal; return `
      <rect width="600" height="900" fill="${p.deep}"/>
      <path d="M90 520 L-60 40 L60 40 Z" fill="${p.light}" opacity="0.12"/><path d="M500 520 L700 60 L560 30 Z" fill="${p.light}" opacity="0.12"/>
      ${smoke(160, 330, 1.5, '#5C6B7A', 0.95)}${smoke(260, 300, 1.2, '#4A5866', 0.9)}
      <g fill="${p.ink}">
        <path d="M40 560 L560 560 L520 630 L90 630 Z"/>
        <rect x="150" y="510" width="300" height="50"/><rect x="230" y="450" width="120" height="60"/>
        <rect x="200" y="370" width="34" height="90"/><rect x="260" y="350" width="34" height="110"/>
        <rect x="190" y="360" width="54" height="12"/><rect x="250" y="340" width="54" height="12"/>
        <rect x="372" y="420" width="10" height="90"/><rect x="330" y="410" width="80" height="6"/>
        <path d="M110 520 h70 v26 h-70 Z M420 520 h70 v26 h-70 Z"/>
        <rect x="40" y="526" width="90" height="10" transform="rotate(-6 85 531)"/><rect x="470" y="526" width="96" height="10" transform="rotate(6 518 531)"/>
      </g>
      ${Array.from({ length: 9 }, (_, i) => `<circle cx="${120 + i * 44}" cy="592" r="5" fill="${p.gold}"/>`).join('')}
      ${waves(640, p.mid, 12, 40)}${waves(690, p.deep, 10, 46, -20)}${waves(740, '#0E1A2C', 8, 52, -10)}
      ${star(300, 470, 14, p.gold)}
      ${T(t, 300, 136, 'Rule', 116, 520, p.light, { spacing: 6 })}
      ${T(t, 300, 244, 'the waves', 96, 520, p.gold, { spacing: 4 })}
      ${T(t, 300, 806, `Join the ${d.imperial ? 'Imperial ' : ''}Fleet`, 40, 500, p.light, { f: 'S', weight: 700, spacing: 3 })}
      ${T(t, 300, 852, d.enemy ? `${d.enemy}'s ships will not reach our shores` : 'An ironclad is only as brave as her crew', 18, 500, p.gold, { f: 'S' })}`; }
  },
  {
    // the airships over the capital
    id: 'skies', title: 'The skies are ours', kind: 'bonds', font: 'propaganda', pal: 'navy',
    art: (d, t) => { const p = t.pal; return `
      <rect width="600" height="900" fill="#0B1424"/>
      ${Array.from({ length: 40 }, (_, i) => `<circle cx="${((i * 137) % 560) + 20}" cy="${((i * 71) % 380) + 30}" r="${i % 5 ? 1.3 : 2.2}" fill="${p.light}" opacity="0.8"/>`).join('')}
      <path d="M150 760 L40 0 L210 0 Z" fill="${p.gold}" opacity="0.16"/><path d="M450 760 L390 0 L570 0 Z" fill="${p.gold}" opacity="0.16"/>
      <g transform="translate(300 300)">
        <ellipse cx="0" cy="0" rx="230" ry="62" fill="${p.mid}"/>
        <ellipse cx="0" cy="-12" rx="214" ry="34" fill="${p.light}" opacity="0.18"/>
        ${Array.from({ length: 9 }, (_, i) => `<path d="M${-180 + i * 45} -58 Q${-176 + i * 45} 0 ${-180 + i * 45} 58" stroke="${p.deep}" stroke-width="2" fill="none" opacity="0.7"/>`).join('')}
        <path d="M200 -10 L262 -60 L262 -4 Z M200 10 L262 60 L262 4 Z" fill="${p.deep}"/>
        <rect x="-70" y="58" width="140" height="28" rx="8" fill="${p.ink}"/><path d="M-60 60 L-40 52 M60 60 L40 52" stroke="${p.ink}" stroke-width="3"/>
        ${crown(-120, 4, 0.36, p.gold, p.deep)}
      </g>
      <path d="M0 900 V720 h40 v-60 h30 v40 h40 v-90 h20 l10 -30 l10 30 h20 v120 h50 v-70 h40 v-40 h20 v40 h50 v90 h30 v-120 l20 -30 l20 30 v120 h40 v-50 h60 v80 h50 V900 Z" fill="${p.ink}"/>
      ${Array.from({ length: 30 }, (_, i) => `<rect x="${((i * 53) % 560) + 20}" y="${740 + ((i * 29) % 120)}" width="5" height="7" fill="${p.gold}" opacity="0.8"/>`).join('')}
      ${T(t, 300, 122, 'The skies', 110, 520, p.light, { spacing: 4 })}
      ${T(t, 300, 218, 'are ours', 96, 520, p.gold, { spacing: 4 })}
      <rect x="40" y="430" width="520" height="104" fill="${p.ink}" opacity="0.75"/>
      ${T(t, 300, 480, 'Buy the airships. Buy war bonds.', 34, 500, p.light, { f: 'S', weight: 700 })}
      ${T(t, 300, 516, d.hc ? `The war chest, by order of ${d.hc}` : `${d.victory}% repaid on victory`, 20, 500, p.gold, { f: 'S' })}`; }
  },
  {
    // the cavalry charge
    id: 'horse', title: 'Ride with the Horse', kind: 'enlist', font: 'condensed', pal: 'khaki',
    art: (d, t) => { const p = t.pal; return `
      <rect width="600" height="900" fill="${p.paper}"/>
      ${rays(470, 340, 28, p.gold, 900)}
      <path d="M0 690 Q300 650 600 690 V900 H0 Z" fill="${p.deep}"/>
      <g transform="translate(300 540)" fill="${p.ink}">
        <path d="M-150 -10 Q-130 -70 -40 -70 L90 -76 Q140 -78 160 -120 L190 -170 L214 -160 L208 -120 L232 -96 L214 -84 L186 -100 Q172 -40 130 -20 L120 10 L150 120 L132 124 L96 30 L60 20 L-40 20 L-70 110 L-90 112 L-74 20 Q-140 20 -170 70 L-190 60 Q-170 0 -150 -10 Z"/>
        <path d="M-100 20 L-140 120 L-122 124 L-80 30 Z"/>
        <path d="M188 -168 L176 -196 L200 -176 Z"/>
        <path d="M-20 -70 L-10 -150 L30 -160 L44 -70 Z"/>
        <circle cx="16" cy="-178" r="18"/><path d="M-6 -188 Q16 -214 38 -188 Z"/>
        <path d="M30 -150 L250 -260 L254 -252 L36 -142 Z"/>
        <path d="M250 -260 L280 -280 L256 -250 Z" fill="${p.mid}"/><path d="M230 -250 L250 -258 L246 -236 Z" fill="${p.mid}"/>
      </g>
      ${smoke(40, 700, 1.4, p.paper, 0.6)}
      ${T(t, 40, 128, 'Ride', 120, 300, p.mid, { anchor: 'start', spacing: 4 })}
      ${T(t, 40, 214, `with the ${d.imperial ? 'Imperial' : 'Royal'}`, 52, 380, p.ink, { anchor: 'start', spacing: 2 })}
      ${T(t, 40, 308, 'Horse', 100, 340, p.ink, { anchor: 'start', spacing: 4 })}
      ${T(t, 300, 790, d.enemy ? `${d.enemy} has never seen a charge like it` : 'The finest cavalry in the world', 26, 500, p.light, { f: 'S', weight: 700 })}
      ${T(t, 300, 846, 'Enlist at the War Room', 20, 460, p.gold, { f: 'S', spacing: 4, weight: 700 })}`; }
  },
  {
    // the home front: every field a front
    id: 'fields', title: 'Every field a front', kind: 'home', font: 'gothic', pal: 'khaki',
    art: (d, t) => { const p = t.pal;
      const ear = (x: number, y: number, r: number) => `<g transform="translate(${x} ${y}) rotate(${r})"><rect x="-2" y="0" width="4" height="230" fill="${p.gold}"/>${Array.from({ length: 7 }, (_, i) => `<ellipse cx="-8" cy="${10 + i * 14}" rx="7" ry="13" fill="${p.gold}" transform="rotate(-25 -8 ${10 + i * 14})"/><ellipse cx="8" cy="${10 + i * 14}" rx="7" ry="13" fill="${p.gold}" transform="rotate(25 8 ${10 + i * 14})"/>`).join('')}</g>`;
      return `
      <rect width="600" height="900" fill="${p.paper}"/>
      <path d="M0 560 L600 500 V900 H0 Z" fill="${p.deep}"/>
      ${Array.from({ length: 10 }, (_, i) => `<path d="M${-40 + i * 70} 900 L${260 + i * 10} 530" stroke="${p.gold}" stroke-width="3" opacity="0.5"/>`).join('')}
      <circle cx="300" cy="410" r="160" fill="${p.mid}"/>
      ${ear(300, 280, -28)}${ear(300, 280, 0)}${ear(300, 280, 28)}
      <g transform="rotate(-38 300 420)"><rect x="160" y="414" width="300" height="14" rx="4" fill="${p.ink}"/><rect x="160" y="410" width="90" height="24" rx="6" fill="${p.ink}"/><path d="M460 414 L512 421 L460 428 Z" fill="${p.light}"/></g>
      <rect x="230" y="470" width="140" height="22" fill="${p.mid}"/>
      ${T(t, 300, 140, 'Every field', 96, 520, p.ink)}
      ${T(t, 300, 236, 'a front', 104, 520, p.mid)}
      ${T(t, 300, 664, 'Grow more. Waste nothing.', 34, 500, p.light, { f: 'S', weight: 700 })}
      ${T(t, 300, 716, d.province ? `The harvest of ${d.province} feeds the Army` : 'The harvest feeds the Army', 24, 500, p.gold, { f: 'S' })}
      ${T(t, 300, 840, sovLine(d), 30, 480, p.light)}`; }
  },
  {
    // careless talk: the Security Service is listening
    id: 'silence', title: 'The enemy is listening', kind: 'home', font: 'fatface', pal: 'blood',
    art: (d, t) => { const p = t.pal; return `
      <rect width="600" height="900" fill="${p.deep}"/>
      <path d="M300 160 Q520 160 520 400 Q520 640 300 640 Q80 640 80 400 Q80 160 300 160 Z" fill="${p.mid}"/>
      <path d="M260 260 A60 60 0 1 1 340 260 L370 520 L230 520 Z" fill="${p.ink}"/>
      <ellipse cx="300" cy="300" rx="48" ry="26" fill="${p.light}"/><circle cx="300" cy="300" r="20" fill="${p.mid}"/><circle cx="300" cy="300" r="9" fill="${p.ink}"/><circle cx="294" cy="294" r="4" fill="${p.light}"/>
      ${T(t, 300, 112, 'The enemy', 84, 520, p.light)}
      ${T(t, 300, 600, 'is listening', 72, 380, p.light)}
      ${T(t, 300, 800, d.enemy ? `${d.enemy} has ears in every tavern` : 'Foreign ears are everywhere', 26, 500, p.gold, { f: 'S', weight: 700 })}
      ${T(t, 300, 846, 'Report approaches to the Security Service', 18, 500, p.light, { f: 'S', spacing: 2 })}`; }
  },
  {
    // the forge: workers for the war chest's factories
    id: 'forge', title: 'Forge the victory', kind: 'bonds', font: 'propaganda', pal: 'steel',
    art: (d, t) => { const p = t.pal;
      const gear = (cx: number, cy: number, r: number, fill: string) => `<g transform="translate(${cx} ${cy})"><circle r="${r}" fill="${fill}"/>${Array.from({ length: 12 }, (_, i) => `<rect x="${-r * 0.12}" y="${-r - r * 0.22}" width="${r * 0.24}" height="${r * 0.3}" fill="${fill}" transform="rotate(${i * 30})"/>`).join('')}<circle r="${r * 0.36}" fill="${p.paper}"/></g>`;
      return `
      <rect width="600" height="900" fill="${p.paper}"/>
      <path d="M0 0 H600 V380 L0 560 Z" fill="${p.mid}"/>
      ${gear(470, 300, 120, p.deep)}${gear(330, 200, 64, p.ink)}
      <path d="M40 900 V640 l60 -40 v40 l60 -40 v40 l60 -40 v40 l60 -40 V900 Z" fill="${p.deep}"/>
      <rect x="70" y="520" width="26" height="110" fill="${p.deep}"/><rect x="130" y="490" width="26" height="140" fill="${p.deep}"/>
      ${smoke(70, 500, 0.8, p.ink, 0.5)}${smoke(130, 470, 0.9, p.ink, 0.5)}
      <g transform="translate(400 600)" fill="${p.ink}">
        <circle cx="0" cy="-200" r="34"/><path d="M-40 -160 L40 -160 L60 0 L20 0 L14 120 L-14 120 L-20 0 L-60 0 Z"/>
        <path d="M30 -150 L120 -250 L140 -232 L54 -128 Z"/>
        <rect x="100" y="-310" width="70" height="40" rx="4" transform="rotate(-40 135 -290)"/>
        <path d="M-30 -150 L-100 -60 L-80 -44 L-14 -124 Z"/>
      </g>
      ${T(t, 40, 142, 'Forge', 120, 340, p.light, { anchor: 'start', spacing: 4 })}
      ${T(t, 40, 236, 'the victory', 80, 330, p.gold, { anchor: 'start', spacing: 2 })}
      <rect x="40" y="780" width="520" height="84" fill="${p.ink}"/>
      ${T(t, 300, 818, `Hands for the factories. ${d.many[0].toUpperCase() + d.many.slice(1)} for the guns.`, 26, 500, p.light, { f: 'S', weight: 700 })}
      ${T(t, 300, 850, d.hc ? `Imperial High Commissioner ${d.hc}: buy war bonds` : 'Buy war bonds', 18, 500, p.gold, { f: 'S', spacing: 2 })}`; }
  },
  {
    // remembrance
    id: 'fallen', title: 'Remember them', kind: 'enlist', font: 'imperial', pal: 'khaki',
    art: (d, t) => { const p = t.pal;
      const poppy = (x: number, y: number, r: number) => `<g transform="translate(${x} ${y})">${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="${-r * 0.55}" rx="${r * 0.5}" ry="${r * 0.6}" fill="${p.mid}" transform="rotate(${a})"/>`).join('')}<circle r="${r * 0.28}" fill="${p.ink}"/></g>`;
      return `
      <rect width="600" height="900" fill="${p.paper}"/>
      <rect x="0" y="0" width="600" height="560" fill="${p.deep}"/>
      ${rays(300, 560, 22, p.ink, 800)}
      <path d="M0 560 Q300 520 600 560 V900 H0 Z" fill="${p.paper}"/>
      <circle cx="300" cy="420" r="150" fill="${p.mid}" opacity="0.85"/>
      <rect x="295" y="320" width="10" height="270" fill="${p.ink}" transform="rotate(-4 300 590)"/><rect x="291" y="440" width="18" height="60" rx="3" fill="${p.ink}" transform="rotate(-4 300 590)"/>
      <path d="M252 318 Q300 262 348 318 Z" fill="${p.ink}"/><ellipse cx="300" cy="320" rx="70" ry="11" fill="${p.ink}"/>
      ${laurel(302, 410, 46, p.gold, 0.6)}
      ${poppy(150, 640, 22)}${poppy(210, 680, 18)}${poppy(420, 650, 24)}${poppy(470, 700, 18)}${poppy(300, 700, 20)}${poppy(90, 720, 16)}${poppy(530, 640, 16)}
      ${T(t, 300, 118, 'Remember', 84, 520, p.light, { spacing: 6 })}
      ${T(t, 300, 190, d.lastWar ? `the fallen of the ${d.lastWar} war` : 'the fallen', 40, 520, p.gold, { spacing: 3 })}
      ${T(t, 300, 800, 'Finish what they began', 40, 520, p.ink)}
      ${T(t, 300, 848, d.general ? `General ${bare(d.general, 'general')} needs you at the front` : 'Enlist at the War Room', 20, 500, p.mid, { f: 'S', weight: 700, spacing: 2 })}`; }
  }
];

// posters for one particular war: shown while the realm fights that nation, or has just fought it
const kessName = (d: PosterData) => d.nations.kessmark || 'Kessmark';
export const WAR_POSTERS: (PosterDef & { against: string })[] = [
  {
    // a river crossing under fire, the towers of the enemy capital on the far bank
    id: 'kess-cross', against: 'kessmark', title: 'Cross the Kess', kind: 'enlist', font: 'propaganda', pal: 'navy',
    art: (d, t) => { const p = t.pal; const cap = PROFILES.kessmark?.capital || 'Kessbridge'; return `
      <rect width="600" height="900" fill="${p.deep}"/>
      ${rays(300, 380, 30, p.mid, 900)}
      <path d="M24 380 V330 h30 v-40 h16 l8 -40 l8 40 h16 v60 h28 v-90 q20 -40 40 0 v90 h30 v-50 h22 v-30 l11 -26 l11 26 v30 h22 v50 h40 v-120 q26 -46 52 0 v120 h26 v-60 h20 l10 -34 l10 34 h20 v60 h40 v-40 h30 v80 Z" fill="${p.ink}"/>
      <rect x="0" y="380" width="600" height="250" fill="${p.mid}"/>
      ${Array.from({ length: 7 }, (_, i) => `<path d="M0 ${410 + i * 32} ${Array.from({ length: 16 }, () => 'q20 -8 40 0').join(' ')}" stroke="${p.light}" stroke-width="2" fill="none" opacity="0.35"/>`).join('')}
      <path d="M-20 900 L200 380 L240 380 L60 900 Z" fill="${p.gold}"/>
      ${Array.from({ length: 9 }, (_, i) => `<rect x="${40 + i * 18 - (i * 5)}" y="${840 - i * 52}" width="${110 - i * 8}" height="6" fill="${p.ink}" transform="skewX(-23)"/>`).join('')}
      ${soldier(120, 760, 1.15, p.ink, true)}${soldier(170, 660, 0.95, p.ink, true)}${soldier(205, 575, 0.8, p.ink, true)}${soldier(232, 505, 0.66, p.ink, true)}
      ${smoke(330, 420, 1.2, p.light, 0.5)}${smoke(420, 470, 0.9, p.light, 0.4)}
      <path d="M0 630 H600 V900 H0 Z" fill="${p.ink}" opacity="0.65"/>
      ${T(t, 300, 128, 'Cross the Kess', 110, 520, p.light, { spacing: 3 })}
      ${T(t, 300, 216, `Take ${cap}`, 80, 520, p.gold, { spacing: 3 })}
      ${T(t, 400, 720, 'The river remembers.', 30, 300, p.light, { f: 'S', weight: 700 })}
      ${T(t, 400, 760, 'So will we.', 30, 300, p.gold, { f: 'S', weight: 700 })}
      ${T(t, 400, 830, 'Enlist at the War Room', 18, 300, p.light, { f: 'S', spacing: 3 })}`; }
  },
  {
    // the merchant republic: the Syndic on his money bags
    id: 'kess-gold', against: 'kessmark', title: 'Their gold, our blood', kind: 'bonds', font: 'fatface', pal: 'blood',
    art: (d, t) => { const p = t.pal; return `
      <rect width="600" height="900" fill="${p.paper}"/>
      <path d="M0 0 H600 V520 L0 600 Z" fill="${p.mid}"/>
      ${[[210, 520, 70], [330, 530, 80], [270, 450, 66], [400, 470, 56]].map(([x, y, r]) => `<g fill="${p.gold}"><ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.82}"/><path d="M${x - r * 0.3} ${y - r * 0.7} L${x} ${y - r * 1.05} L${x + r * 0.3} ${y - r * 0.7} Z"/></g>${T(t, x, y + 14, '¤', r * 0.7, r, p.mid)}`).join('')}
      <g fill="${p.ink}"><rect x="256" y="200" width="88" height="74"/><rect x="236" y="270" width="128" height="12"/><ellipse cx="300" cy="318" rx="42" ry="44"/><path d="M226 384 Q300 350 374 384 L396 470 H204 Z"/><path d="M370 392 L452 330 L462 342 L384 410 Z"/></g>
      <path d="M456 334 V250 M410 256 H502" stroke="${p.gold}" stroke-width="5"/><path d="M410 256 l-22 44 h44 Z M502 256 l-22 44 h44 Z" fill="${p.gold}" opacity="0.9"/>
      ${T(t, 300, 126, 'Their gold', 96, 520, p.gold)}
      ${T(t, 300, 680, 'Our blood?', 104, 520, p.mid)}
      ${T(t, 300, 748, `${kessName(d)}'s merchants grow fat on this war`, 24, 500, p.ink, { f: 'S', weight: 700 })}
      ${T(t, 300, 800, `Out-buy them: war bonds, ${d.victory}% on victory`, 24, 500, p.mid, { f: 'S', weight: 700 })}
      ${T(t, 300, 848, `Every ${d.one} you lend is a ${d.one} they never see`, 18, 500, p.ink, { f: 'S' })}`; }
  },
  {
    // the map: the Kess Valley, and the arrow that takes it (or holds it)
    id: 'kess-valley', against: 'kessmark', title: 'The Kess Valley', kind: 'enlist', font: 'imperial', pal: 'khaki',
    art: (d, t) => { const p = t.pal; return `
      <rect width="600" height="900" fill="${p.paper}"/>
      <rect x="60" y="180" width="480" height="470" fill="${p.light}" stroke="${p.ink}" stroke-width="3"/>
      <rect x="60" y="180" width="480" height="470" fill="url(#HT_ID)" opacity="0.5"/>
      <path d="M150 200 Q230 260 210 340 T260 480 Q300 560 240 640" stroke="${p.deep}" stroke-width="5" fill="none" stroke-dasharray="10 8"/>
      <path d="M330 190 Q300 300 360 380 T340 640" stroke="#3E6A8C" stroke-width="18" fill="none"/>
      <path d="M300 250 Q420 230 470 330 Q500 460 420 560 Q340 610 280 540 Q240 430 300 250 Z" fill="${d.kessHeld ? p.mid : p.deep}" opacity="0.55"/>
      ${star(400, 420, 18, p.mid)}
      ${T(t, 400, 470, PROFILES.kessmark?.capital || 'Kessbridge', 18, 160, p.ink, { f: 'S', weight: 700 })}
      <path d="M90 560 Q180 420 300 400 L292 380 L350 410 L300 450 L298 428 Q200 450 120 580 Z" fill="${p.mid}"/>
      ${T(t, 120, 300, d.place, 22, 100, p.ink, { f: 'S', weight: 700, spacing: 2 })}
      ${T(t, 450, 250, kessName(d), 22, 160, p.ink, { f: 'S', weight: 700, spacing: 3 })}
      ${T(t, 300, 112, d.kessHeld ? 'Hold' : 'Win back', 84, 520, p.ink, { spacing: 4 })}
      ${T(t, 300, 728, 'the Kess Valley', 64, 520, p.mid, { spacing: 2 })}
      ${T(t, 300, 790, d.kessHeld ? 'Our farms, our river, our flag' : 'Ours by right, theirs by theft', 26, 500, p.ink, { f: 'S', weight: 700 })}
      ${T(t, 300, 846, d.general ? `General ${bare(d.general, 'general')} leads the advance` : 'Enlist at the War Room', 20, 500, p.deep, { f: 'S', spacing: 2, weight: 700 })}`; }
  }
];
export const warPostersFor = (d: PosterData) => WAR_POSTERS.filter((p) => p.against === (d.enemyId || d.lastWarId));

// the enemy's posters, in their own colours: defectors at their court sign them
export const ENEMY_POSTERS: PosterDef[] = [
  {
    id: 'gohome', title: 'Go home', kind: 'home', font: 'propaganda', pal: 'steel', enemy: true,
    art: (d, t) => { const p = t.pal; return `
      <rect width="600" height="900" fill="${p.deep}"/>
      ${rays(300, 900, 30, p.ink, 1000)}
      <circle cx="300" cy="520" r="190" fill="${p.mid}" opacity="0.9"/>${soldier(300, 650, 2.2, p.ink, false)}
      <rect x="40" y="660" width="520" height="8" fill="${p.mid}"/>
      ${T(t, 300, 130, `Soldiers of ${d.place}`, 70, 520, p.light, { spacing: 2 })}
      ${T(t, 300, 230, 'go home', 112, 520, p.mid, { spacing: 4 })}
      ${T(t, 300, 740, d.sovereign ? `${sovLine(d)} feasts while you freeze` : 'Your masters feast while you freeze', 26, 500, p.light, { f: 'S', weight: 700 })}`; }
  },
  {
    id: 'unbroken', title: 'Unbroken', kind: 'home', font: 'gothic', pal: 'navy', enemy: true,
    art: (d, t) => { const p = t.pal; return `
      <rect width="600" height="900" fill="${p.paper}"/>
      <path d="M300 140 L470 220 V420 Q470 600 300 700 Q130 600 130 420 V220 Z" fill="${p.deep}"/>
      <path d="M300 180 L440 246 V420 Q440 570 300 655 Q160 570 160 420 V246 Z" fill="${p.mid}"/>
      ${star(300, 400, 90, p.gold)}
      ${T(t, 300, 110, d.enemy ?? 'We', 72, 520, p.deep)}
      ${T(t, 300, 790, 'stands unbroken', 72, 520, p.deep)}`; }
  }
];
export const enemyPal = (nid: string | null) => (({ drakmoor: 'steel', kessmark: 'navy', varnholm: 'khaki', orrin: 'navy', tessaly: 'realm', sundmere: 'khaki', aurel: 'porphyry' } as Record<string, string>)[nid || ''] || 'steel');
// the High Commission's own poster: a slogan of its choosing in the same frame
export const COMMISSION: PosterDef = {
  id: 'decree', title: 'By order', kind: 'home', font: 'imperial', pal: 'porphyry',
  art: (_d, t) => { const p = t.pal; return `
    <rect width="600" height="900" fill="${p.deep}"/>
    ${rays(300, 330, 36, p.mid, 900)}
    ${eagle(300, 360, 0.86, p.ink, p.gold)}
    <rect x="40" y="560" width="520" height="2" fill="${p.gold}"/>`; }
};

// ---------------------------------------------------------------- render
export const posterById = (id: string) => POSTERS.find((p) => p.id === id) || WAR_POSTERS.find((p) => p.id === id) || ENEMY_POSTERS.find((p) => p.id === id) || (id === COMMISSION.id ? COMMISSION : null);
export function renderPoster(def: PosterDef, d: PosterData, o: { font?: string; pal?: string; graffiti?: Scrawl[]; extra?: (t: Theme) => string } = {}) {
  const t: Theme = { pal: PALETTES[o.pal || def.pal] ?? PALETTES.porphyry, font: FONTS[o.font || ''] ? o.font! : def.font };
  return press(t, def.art(d, t) + (o.extra ? o.extra(t) : ''), { id: def.id, graffiti: o.graffiti, frameColor: t.pal.ink });
}
// the commissioned poster: its slogan in big type, its patron underneath
export function renderCommission(d: PosterData, slogan: string, by: string, o: { font?: string; pal?: string; graffiti?: Scrawl[] } = {}) {
  return renderPoster(COMMISSION, d, { ...o, extra: (t) => {
    const words = slogan.split(/\s+/); const half = Math.ceil(words.length / 2);
    const a = words.length > 3 ? words.slice(0, half).join(' ') : slogan, b = words.length > 3 ? words.slice(half).join(' ') : '';
    return `${T(t, 300, b ? 670 : 720, a, 74, 520, t.pal.light, { spacing: 2 })}${b ? T(t, 300, 764, b, 74, 520, t.pal.gold, { spacing: 2 }) : ''}${T(t, 300, 846, `By order of ${by}`, 20, 500, t.pal.gold, { f: 'S', spacing: 3, weight: 700 })}`;
  } });
}
// the enemy poster, with the names of the defectors who signed it
export function renderEnemy(def: PosterDef, d: PosterData, nationId: string | null, signers: string[]) {
  return renderPoster(def, d, { pal: enemyPal(nationId), extra: (t) => signers.length
    ? `<rect x="40" y="796" width="520" height="68" fill="${t.pal.ink}" opacity="0.88"/>${T(t, 300, 826, `Signed by ${signers.slice(0, 4).join(', ')}${signers.length > 4 ? ` and ${signers.length - 4} more` : ''}`, 20, 500, t.pal.light, { f: 'S', weight: 700 })}${T(t, 300, 852, `once of ${d.place}`, 16, 480, t.pal.gold, { f: 'S', italic: true })}`
    : T(t, 300, 846, `Printed in ${d.enemy || 'enemy lands'}`, 16, 480, t.pal.light, { f: 'S', spacing: 3 }) });
}

// ---------------------------------------------------------------- in the browser
// shrink any line wider than its data-max (real fonts differ from the estimate), then squeeze it if it is still too wide
export function fitPosters(root: ParentNode) {
  root.querySelectorAll('svg[data-poster] text[data-max]').forEach((el: any) => {
    const max = Number(el.getAttribute('data-max'));
    let len = el.getComputedTextLength?.() || 0;
    if (!(len > max)) return;
    const size = Number(el.getAttribute('font-size'));
    el.setAttribute('font-size', String(Math.max(8, Math.floor((size * max) / len))));
    len = el.getComputedTextLength();
    if (len > max) (el.setAttribute('textLength', String(max)), el.setAttribute('lengthAdjust', 'spacingAndGlyphs'));
  });
}
// the poster fonts, loaded once for the page; resolves when they are ready
export function loadPosterFonts(): Promise<unknown> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (!document.getElementById('poster-fonts')) {
    const l = document.createElement('link');
    l.id = 'poster-fonts'; l.rel = 'stylesheet'; l.href = FONT_CSS;
    document.head.appendChild(l);
  }
  const fams = ['Cinzel', 'Bebas Neue', 'Oswald', 'UnifrakturMaguntia', 'Abril Fatface', 'Alfa Slab One', 'Permanent Marker'];
  return Promise.all(fams.map((f) => (document as any).fonts?.load?.(`40px "${f}"`).catch(() => null)));
}
// a saved PNG carries its fonts: fetch the font files and put them inside the SVG before drawing it
let fontFaces: Promise<string> | null = null;
async function embeddedFonts() {
  fontFaces ??= (async () => {
    const css = await (await fetch(FONT_CSS)).text();
    const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
    const data = await Promise.all(urls.map(async (u) => { const b = await (await fetch(u)).blob(); return await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(b); }); }));
    let out = css;
    urls.forEach((u, i) => (out = out.split(u).join(data[i])));
    return out;
  })().catch(() => '');
  return fontFaces;
}
export async function savePoster(svgEl: SVGSVGElement | null, name: string) {
  if (!svgEl) return;
  const faces = await embeddedFonts();
  const copy = svgEl.cloneNode(true) as SVGSVGElement;
  copy.removeAttribute('style');
  copy.setAttribute('width', '600'); copy.setAttribute('height', '900');
  if (faces) copy.insertAdjacentHTML('afterbegin', `<style>${faces}</style>`);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
  await new Promise((r) => setTimeout(r, 150));
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 1800;
  c.getContext('2d')!.drawImage(img, 0, 0, 1200, 1800);
  URL.revokeObjectURL(url);
  const a = document.createElement('a');
  a.download = name + '.png';
  a.href = c.toDataURL('image/png');
  a.click();
}
