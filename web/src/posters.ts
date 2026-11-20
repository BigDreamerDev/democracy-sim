// Wartime posters: original designs in the manner of the great recruiting and war-bond posters, drawn as SVG in the
// empire's porphyry and gold (or the realm's own ink and teal). Every name comes from the live world: the sovereign,
// the General, the Imperial High Commissioner, the enemy and the realm. Used by the war room (atlas.tsx), and saved as
// images from there.
import { nm, holderOf, realmPlace, inForce } from '../../engine/index';
import { highCommission } from '../../engine/empire';
import { BOND_PAYS } from '../../engine/war';

export type PosterData = { place: string; sovereign: string | null; sovTitle: string; general: string | null; hc: string | null; enemy: string | null; victory: number; imperial: boolean };
export function posterData(w: any): PosterData {
  const imperial = inForce(w, 'imperial');
  const hos = w.hos?.holder;
  const monarchy = w.config?.hos === 'monarchy';
  return {
    place: realmPlace(w),
    sovereign: hos ? nm(w, hos) : null,
    sovTitle: monarchy ? w.config.hosTitle : 'President',
    general: holderOf(w, 'army') ? nm(w, holderOf(w, 'army')) : null,
    hc: highCommission(w)?.holder ? nm(w, highCommission(w).holder) : null,
    enemy: w.army?.war ? w.nations[w.army.war]?.name ?? null : null,
    victory: Math.round(BOND_PAYS.victory * 100),
    imperial
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const U = (s: string) => esc(s.toUpperCase());
// a line of type that never runs off the poster: shrink the font to fit the width
const line = (x: number, y: number, s: string, size: number, max: number, fill: string, o: { anchor?: string; font?: string; weight?: number; spacing?: number } = {}) => {
  const caps = s === s.toUpperCase() && /[A-Z]/.test(s);
  const per = (o.font === 'sans' ? (caps ? 0.7 : 0.55) : caps ? 0.74 : 0.56) * size + (o.spacing ?? 0);
  const fit = Math.min(size, Math.floor(max / Math.max(1, s.length) / (per / size)));
  return `<text x="${x}" y="${y}" font-size="${fit}" fill="${fill}" text-anchor="${o.anchor ?? 'middle'}" font-family="${o.font === 'sans' ? "'Atkinson Hyperlegible', Arial, sans-serif" : "Gloock, Georgia, 'Times New Roman', serif"}" font-weight="${o.weight ?? 400}" letter-spacing="${o.spacing ?? 0}">${esc(s)}</text>`;
};
const crown = (cx: number, cy: number, s: number, fill: string) =>
  `<g transform="translate(${cx - 50 * s} ${cy - 40 * s}) scale(${s})" fill="${fill}"><path d="M5 70 L0 20 L25 42 L50 5 L75 42 L100 20 L95 70 Z"/><rect x="5" y="72" width="90" height="12"/><circle cx="0" cy="18" r="6"/><circle cx="50" cy="4" r="7"/><circle cx="100" cy="18" r="6"/></g>`;
const laurel = (cx: number, cy: number, r: number, fill: string) => {
  let out = '';
  for (let side = -1; side <= 1; side += 2)
    for (let i = 0; i < 9; i++) {
      const a = (Math.PI / 2) + side * (0.35 + i * 0.27);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      out += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(r * 0.13).toFixed(1)}" ry="${(r * 0.055).toFixed(1)}" transform="rotate(${((a * 180) / Math.PI + 90 * side).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${fill}"/>`;
    }
  return out;
};
const rays = (cx: number, cy: number, n: number, fill: string, len = 900) => {
  let out = '';
  for (let i = 0; i < n; i++) {
    const a1 = (i / n) * Math.PI * 2, a2 = ((i + 0.5) / n) * Math.PI * 2;
    out += `<path d="M${cx} ${cy} L${(cx + Math.cos(a1) * len).toFixed(0)} ${(cy + Math.sin(a1) * len).toFixed(0)} L${(cx + Math.cos(a2) * len).toFixed(0)} ${(cy + Math.sin(a2) * len).toFixed(0)} Z" fill="${fill}"/>`;
  }
  return out;
};
const frame = (bg: string, rule: string, inner: string, foot: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900" width="600" height="900"><rect width="600" height="900" fill="${bg}"/>${inner}<rect x="14" y="14" width="572" height="872" fill="none" stroke="${rule}" stroke-width="4"/><rect x="24" y="24" width="552" height="852" fill="none" stroke="${rule}" stroke-width="1.5"/>${foot}</svg>`;

// palettes: the empire's porphyry and gold, or the realm's ink, red and teal on paper
const PAL = (d: PosterData) => d.imperial
  ? { paper: '#F1E6CC', deep: '#4A1430', mid: '#7A1F45', gold: '#C9A13B', light: '#F6EBDC', ink: '#2A0E1C' }
  : { paper: '#F3EBDD', deep: '#1F3B4A', mid: '#A3322B', gold: '#C08A2E', light: '#F7F1E5', ink: '#1A1A1A' };
const realmWord = (d: PosterData) => (d.imperial ? 'Empire' : 'Realm');
const sovLine = (d: PosterData) => (d.sovereign ? (d.sovereign.toLowerCase().startsWith(d.sovTitle.toLowerCase()) ? d.sovereign : `${d.sovTitle} ${d.sovereign}`) : `The ${realmWord(d)}`);

export const POSTERS: { id: string; title: string; kind: 'enlist' | 'bonds'; svg: (d: PosterData) => string }[] = [
  {
    // after the pointing-finger recruiting posters of 1914–17
    id: 'wants', title: 'Wants you', kind: 'enlist',
    svg: (d) => { const p = PAL(d); return frame(p.paper, p.deep, `
      <rect x="24" y="24" width="552" height="128" fill="${p.deep}"/>
      ${line(300, 108, sovLine(d), 50, 520, p.light)}
      <clipPath id="halo"><rect x="24" y="152" width="552" height="448"/></clipPath>
      <g clip-path="url(#halo)">${rays(300, 380, 28, p.light, 300)}<circle cx="300" cy="380" r="205" fill="none" stroke="${p.gold}" stroke-width="6"/></g>
      <path d="M150 600 Q160 470 300 455 Q440 470 450 600 Z" fill="${p.deep}"/>
      <path d="M262 455 L338 455 L322 520 L278 520 Z" fill="${p.gold}"/>
      <rect x="280" y="400" width="40" height="60" fill="#D9AE86"/>
      <ellipse cx="300" cy="350" rx="58" ry="68" fill="#E9C9A6"/>
      <path d="M242 350 Q240 270 300 268 Q360 270 358 350 Q350 300 300 298 Q250 300 242 350 Z" fill="${p.ink}"/>
      ${crown(300, 262, 0.62, p.gold)}
      <circle cx="281" cy="352" r="5" fill="${p.ink}"/><circle cx="319" cy="352" r="5" fill="${p.ink}"/>
      <path d="M285 392 Q300 400 315 392" stroke="${p.mid}" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M430 520 Q470 520 455 600 L360 600 Q380 545 430 520 Z" fill="${p.mid}"/>
      <ellipse cx="402" cy="560" rx="46" ry="40" fill="#E9C9A6"/>
      <circle cx="402" cy="556" r="25" fill="#D9AE86"/><circle cx="402" cy="552" r="13" fill="#F3DCC2"/>
      <rect x="24" y="600" width="552" height="6" fill="${p.deep}"/>
      ${line(300, 700, 'WANTS YOU', 100, 540, p.deep)}
      ${line(300, 752, `FOR THE ${realmWord(d).toUpperCase()}'S ARMY`, 30, 520, p.mid, { font: 'sans', weight: 700, spacing: 2 })}`,
      `${line(300, 820, d.enemy ? `${d.enemy} will not wait. Neither should you.` : 'Enlist at the War Room.', 22, 520, p.ink, { font: 'sans' })}${line(300, 856, `God save the ${d.sovTitle}`, 18, 500, p.mid, { font: 'sans', spacing: 3 })}`); }
  },
  {
    // after the sunburst war-bond posters
    id: 'lend', title: 'Lend your crowns', kind: 'bonds',
    svg: (d) => { const p = PAL(d); return frame(p.deep, p.gold, `
      ${rays(300, 430, 36, p.mid)}
      <circle cx="300" cy="430" r="150" fill="${p.gold}"/><circle cx="300" cy="430" r="132" fill="none" stroke="${p.deep}" stroke-width="4"/>
      ${crown(300, 385, 0.7, p.deep)}
      ${line(300, 500, `${d.victory}%`, 64, 220, p.deep)}
      ${line(300, 530, 'ON VICTORY', 18, 200, p.deep, { font: 'sans', weight: 700, spacing: 3 })}
      ${line(300, 130, 'LEND YOUR', 70, 520, p.light)}
      ${line(300, 205, 'CROWNS', 92, 520, p.gold)}
      ${line(300, 680, `BUY ${d.imperial ? 'IMPERIAL ' : ''}WAR BONDS`, 44, 530, p.light)}
      ${line(300, 730, d.enemy ? `and put an end to ${d.enemy}` : 'and keep the peace you paid for', 26, 520, p.gold, { font: 'sans' })}`,
      `${line(300, 830, d.hc ? `By order of Imperial High Commissioner ${d.hc}` : `By order of ${sovLine(d)}`, 20, 520, p.light, { font: 'sans' })}${line(300, 858, `The ${realmWord(d)} repays every crown`, 16, 500, p.gold, { font: 'sans', spacing: 2 })}`); }
  },
  {
    // after the marching-column posters: the General at the head
    id: 'march', title: 'March with the General', kind: 'enlist',
    svg: (d) => { const p = PAL(d);
      let men = '';
      for (let r = 0; r < 4; r++) for (let i = 0; i < 7; i++) {
        const x = 64 + i * 74 + r * 14, y = 500 + r * 62, s = 0.8 + r * 0.12;
        men += `<g transform="translate(${x} ${y}) scale(${s})" fill="${p.ink}"><circle cx="0" cy="-48" r="11"/><path d="M-14 -54 Q0 -72 14 -54 Z"/><rect x="-11" y="-36" width="22" height="40" rx="4"/><rect x="-10" y="4" width="8" height="30"/><rect x="2" y="4" width="8" height="30"/><rect x="12" y="-95" width="3.5" height="90" transform="rotate(8)"/></g>`;
      }
      return frame(p.paper, p.ink, `
      <clipPath id="sky"><rect x="24" y="24" width="552" height="400"/></clipPath>
      <rect x="24" y="24" width="552" height="400" fill="${p.mid}"/><g clip-path="url(#sky)">${rays(300, 430, 24, p.deep, 700)}<circle cx="300" cy="430" r="110" fill="${p.gold}"/></g>
      <rect x="24" y="420" width="552" height="6" fill="${p.ink}"/>
      ${men}
      ${line(300, 110, d.general ? `GENERAL ${d.general.toUpperCase().replace(/^GENERAL\s+/, '')}` : `THE ${realmWord(d).toUpperCase()}'S ARMY`, 48, 530, p.light)}
      ${line(300, 175, 'MARCHES.', 72, 520, p.gold)}
      ${line(300, 250, 'MARCH WITH', 52, 520, p.light)}
      ${line(300, 310, d.general ? 'HIM.' : 'IT.', 64, 520, p.light)}`,
      `${line(300, 810, 'EVERY VOLUNTEER IS HALF A REGIMENT', 26, 530, p.ink, { font: 'sans', weight: 700, spacing: 1 })}${line(300, 845, d.enemy ? `The front with ${d.enemy} is waiting. Enlist today.` : 'Enlist at the War Room today.', 20, 520, p.mid, { font: 'sans' })}`); }
  },
  {
    // after the munitions posters: the war chest turns crowns into guns
    id: 'cannon', title: 'Every crown a cannon', kind: 'bonds',
    svg: (d) => { const p = PAL(d); return frame(p.paper, p.deep, `
      <rect x="24" y="24" width="552" height="852" fill="${p.paper}"/>
      <path d="M24 560 L576 470 L576 876 L24 876 Z" fill="${p.deep}"/>
      <g fill="${p.ink}"><rect x="150" y="400" width="360" height="56" rx="24" transform="rotate(-18 330 428)"/><rect x="120" y="440" width="80" height="80" rx="10"/></g>
      <circle cx="180" cy="540" r="78" fill="none" stroke="${p.gold}" stroke-width="18"/><circle cx="180" cy="540" r="14" fill="${p.gold}"/>
      ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${176}" y="${470}" width="8" height="140" fill="${p.gold}" transform="rotate(${i * 30} 180 540)"/>`).join('')}
      <circle cx="470" cy="330" r="46" fill="${p.gold}"/>${crown(470, 330, 0.36, p.deep)}
      ${line(300, 120, 'EVERY CROWN', 76, 540, p.deep)}
      ${line(300, 210, 'A CANNON', 96, 540, p.mid)}`,
      `${line(300, 700, 'Buy war bonds. Fill the war chest.', 30, 520, p.light, { font: 'sans', weight: 700 })}${line(300, 760, d.hc ? `Imperial High Commissioner ${d.hc}` : `${sovLine(d)} asks it of you`, 24, 520, p.gold)}${line(300, 840, `${d.victory}% repaid on victory`, 20, 500, p.light, { font: 'sans', spacing: 2 })}`); }
  },
  {
    // after the laurel-and-crown appeals to the nation
    id: 'calls', title: 'The Empire calls', kind: 'enlist',
    svg: (d) => { const p = PAL(d); return frame(p.deep, p.gold, `
      ${line(300, 110, `DAUGHTERS AND SONS OF ${d.place.toUpperCase()}`, 30, 520, p.gold, { font: 'sans', weight: 700, spacing: 2 })}
      ${laurel(300, 380, 170, p.gold)}
      <circle cx="300" cy="380" r="120" fill="${p.mid}"/>
      ${crown(300, 380, 1.2, p.gold)}
      ${line(300, 640, `THE ${realmWord(d).toUpperCase()}`, 64, 520, p.light)}
      ${line(300, 720, 'CALLS', 96, 520, p.gold)}
      ${line(300, 780, 'Will you answer?', 30, 500, p.light, { font: 'sans' })}`,
      `${line(300, 850, sovLine(d), 24, 520, p.gold, { spacing: 2 })}`); }
  },
  {
    // after the "they shall not pass" posters: typographic, defiant
    id: 'firm', title: 'They shall not pass', kind: 'enlist',
    svg: (d) => { const p = PAL(d); return frame(p.mid, p.light, `
      <rect x="60" y="80" width="480" height="740" fill="none" stroke="${p.gold}" stroke-width="3"/>
      ${crown(300, 190, 0.9, p.gold)}
      ${line(300, 340, 'STAND', 120, 460, p.light)}
      ${line(300, 450, 'FIRM', 140, 460, p.gold)}
      <rect x="140" y="490" width="320" height="4" fill="${p.light}"/>
      ${line(300, 570, d.enemy ? `${U(d.enemy)}` : 'NO ENEMY', 46, 440, p.light)}
      ${line(300, 630, 'SHALL NOT PASS', 52, 440, p.light)}
      ${line(300, 720, d.general ? `With General ${d.general.replace(/^General\s+/i, '')} at the front` : 'The Army holds the line', 22, 440, p.gold, { font: 'sans' })}`,
      `${line(300, 780, `${sovLine(d)} is with you`, 22, 440, p.light, { font: 'sans', spacing: 1 })}`); }
  }
];

// turn a poster into a PNG and download it (the web fonts may fall back to Georgia inside the image)
export async function savePoster(svg: string, name: string) {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 1800;
  c.getContext('2d')!.drawImage(img, 0, 0, 1200, 1800);
  URL.revokeObjectURL(url);
  const a = document.createElement('a');
  a.download = name + '.png';
  a.href = c.toDataURL('image/png');
  a.click();
}
