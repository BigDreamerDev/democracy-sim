// An election result as a picture for the group chat: drawn on a canvas in the paper-and-ink look, then the phone's
// share sheet (with the image attached) or a download.
import { nm, recap, fmtDay } from '../../engine/index';
import { toast } from './store';

const P = { paper: '#EEF0E8', ink: '#1B2430', muted: '#4A5560', rule: '#C3CFC0', teal: '#1F5E57', red: '#A8321F' };

export async function shareResult(w: any, e: any) {
  const r = e.results;
  if (!r) return;
  try { await (document as any).fonts?.load?.('32px Gloock'); } catch {}
  const rows = r.ranked.slice(0, 10);
  const W = 1080, H = 300 + rows.length * 92 + 120;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const serif = (n: number) => `${n}px Gloock, Georgia, serif`;
  const sans = (n: number, b = false) => `${b ? '700 ' : ''}${n}px "Atkinson Hyperlegible", Arial, sans-serif`;
  g.fillStyle = P.paper;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = P.ink;
  g.lineWidth = 4;
  g.strokeRect(28, 28, W - 56, H - 56);
  g.lineWidth = 1.5;
  g.strokeRect(40, 40, W - 80, H - 80);
  g.fillStyle = P.muted;
  g.font = sans(28, true);
  g.fillText(String(w.config.realmName).toUpperCase() + ' · RESULT', 80, 112);
  g.fillStyle = P.ink;
  g.font = serif(60);
  g.fillText(fit(g, e.title, W - 160), 80, 186);
  g.fillStyle = P.muted;
  g.font = sans(28);
  g.fillText(`Turnout ${r.turnout} · ${(r.method || 'single') === 'single' ? 'first past the post' : r.method}${r.draw ? ' · tie settled by lot' : ''}`, 80, 234);
  const top = Math.max(1, ...rows.map((id: string) => Number(r.counts?.[id]) || 0));
  rows.forEach((id: string, i: number) => {
    const y = 300 + i * 92;
    const won = r.winners.includes(id);
    const c = w.citizens[id];
    const party = c?.party && w.parties[c.party];
    g.fillStyle = won ? P.teal : P.ink;
    g.font = serif(40);
    g.fillText(fit(g, nm(w, id) || 'Unknown', 560), 80, y + 38);
    g.fillStyle = P.muted;
    g.font = sans(24);
    g.fillText(party ? party.name : 'Independent', 80, y + 72);
    const n = Number(r.counts?.[id]) || 0;
    const bw = Math.round((n / top) * 260);
    g.fillStyle = party?.colour || (won ? P.teal : P.rule);
    g.fillRect(660, y + 12, Math.max(4, bw), 34);
    g.fillStyle = P.ink;
    g.font = sans(32, true);
    g.textAlign = 'right';
    g.fillText(String(n), W - 80, y + 40);
    g.textAlign = 'left';
    if (won) {
      g.save();
      g.translate(W - 210, y + 64);
      g.rotate(-0.06);
      g.strokeStyle = P.red;
      g.fillStyle = P.red;
      g.lineWidth = 3;
      g.strokeRect(0, -22, 112, 30);
      g.font = sans(20, true);
      g.fillText('ELECTED', 12, 1);
      g.restore();
    }
  });
  g.fillStyle = P.muted;
  g.font = sans(24);
  g.fillText(location.host + location.pathname, 80, H - 72);
  await send(cv, e.title || 'result');
}
async function send(cv: HTMLCanvasElement, title: string) {
  const blob: Blob | null = await new Promise((res) => cv.toBlob(res, 'image/png'));
  if (!blob) return toast('Couldn’t draw the picture.', true);
  const name = title.replace(/[^\w]+/g, '-').toLowerCase() + '.png';
  const file = new File([blob], name, { type: 'image/png' });
  const nav: any = navigator;
  try {
    if (nav.canShare?.({ files: [file] })) return void (await nav.share({ files: [file], title }));
  } catch (x: any) {
    if (x?.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Saved the picture. Post it in the group.');
}

// the week in one picture: a front-page panel of what passed, who rebelled and who's up
export async function shareRecap(w: any) {
  const r = recap(w);
  try { await (document as any).fonts?.load?.('32px Gloock'); } catch {}
  const rows: [string, string, string?][] = [
    ['New laws', r.laws.length ? r.laws.map((l) => l.title).join(', ') : 'None this week'],
    ['Bills', `${r.tabled} tabled, ${r.defeated} defeated`],
    ...r.elections.map((e) => ['Elected', `${e.title}: ${e.winners.map((x) => nm(w, x)).join(', ') || 'nobody'}`] as [string, string]),
    ...r.crises.map((c) => ['Crisis', c] as [string, string]),
    ['Biggest rebel', r.rebel ? `${nm(w, r.rebel.id)}, ${r.rebel.n} against the whip` : 'Nobody broke ranks', r.rebel ? P.red : undefined],
    ['Loudest', r.loudest ? `${nm(w, r.loudest.id)}, ${r.loudest.n} speech${r.loudest.n > 1 ? 'es' : ''}` : 'A quiet House'],
    ['Most influential', r.top ? `${nm(w, r.top.id)}, ${r.top.n} Influence` : '—', P.teal],
    ['Prime Minister', r.pm ? `${nm(w, r.pm.id)}, ${r.pm.approval}% approval` : 'No government'],
    ...r.meters.map((m) => [m.key === 'prosperity' ? 'Prosperity' : 'Stability', `${m.now} (${m.d >= 0 ? '+' : ''}${m.d} this week)`, m.d < 0 ? P.red : P.teal] as [string, string, string])
  ];
  const W = 1080, H = 300 + rows.length * 84 + 110;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const serif = (n: number) => `${n}px Gloock, Georgia, serif`;
  const sans = (n: number, b = false) => `${b ? '700 ' : ''}${n}px "Atkinson Hyperlegible", Arial, sans-serif`;
  g.fillStyle = P.paper;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = P.ink;
  g.lineWidth = 4;
  g.strokeRect(28, 28, W - 56, H - 56);
  g.lineWidth = 1.5;
  g.strokeRect(40, 40, W - 80, H - 80);
  g.fillStyle = P.muted;
  g.font = sans(28, true);
  g.fillText(String(w.config.realmName).toUpperCase() + ' · THE WEEK', 80, 112);
  g.fillStyle = P.ink;
  g.font = serif(64);
  g.fillText(`${fmtDay(r.from)} to ${fmtDay(r.to)}`, 80, 192);
  g.fillRect(80, 228, W - 160, 3);
  rows.forEach(([k, v, colour], i) => {
    const y = 290 + i * 84;
    g.fillStyle = P.muted;
    g.font = sans(24, true);
    g.fillText(k.toUpperCase(), 80, y);
    g.fillStyle = colour || P.ink;
    g.font = serif(36);
    g.fillText(fit(g, v, W - 160), 80, y + 44);
  });
  g.fillStyle = P.muted;
  g.font = sans(24);
  g.fillText(location.host + location.pathname, 80, H - 72);
  await send(cv, `${w.config.realmName} week to ${fmtDay(r.to)}`);
}
function fit(g: CanvasRenderingContext2D, s: string, max: number) {
  if (g.measureText(s).width <= max) return s;
  while (s.length > 1 && g.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}
