// The state of the realm as plain text, ready to paste into the group chat. Reads public things only (who holds
// which public office, what's open, the numbers), so it's the same from a player's view or the full world.
// The site's Copy button and the server's /api/public/digest.txt both use this.
import { W, nm, fmtTime, ordinal, hosTitle, majority } from './core';
import { KINDS } from './proposals';
import { SETTABLE } from './proposals';

export function digest(w: W): string {
  const L: string[] = [];
  const when = fmtTime(w, w.now);
  L.push(`*${w.config.realmName}* · ${when}`);
  if (w.clock?.pausedAt) L.push(`⏸ The realm is paused${w.clock.reason ? `: ${w.clock.reason}` : ''}.`);
  if (w.martial) L.push(`⚠ ${w.martial.emergency ? 'State of emergency' : 'Martial law'}, led by ${nm(w, w.martial.leader)}, until ${fmtTime(w, w.martial.until)}.`);
  if (w.phase === 'convention') {
    const open = w.convention.clauses.filter((c: any) => c.adopted === null).length;
    L.push(`The Founding Convention is sitting: ${open} clause${open === 1 ? '' : 's'} still open, closing ${fmtTime(w, w.convention.closesAt)}.`);
    return L.join('\n');
  }
  L.push('');
  L.push(`${ordinal(Math.max(1, w.season?.n || 1))} Parliament, ${w.config.seats} seats (majority ${majority(w)}).`);
  L.push(`PM: ${w.pm ? nm(w, w.pm) : 'none (no one commands a majority yet)'} · ${hosTitle(w)}: ${nm(w, w.hos?.holder) || 'vacant'} · Speaker: ${nm(w, w.speaker) || 'vacant'}`);
  const seats: Record<string, number> = {};
  w.seats.filter(Boolean).forEach((m: string) => { const p = w.citizens[m]?.party; const k = p && w.parties[p] ? w.parties[p].name : 'Independents'; seats[k] = (seats[k] || 0) + 1; });
  const st = Object.entries(seats).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
  if (st) L.push(`Seats: ${st}.`);
  const ministers = (Object.values(w.offices) as any[]).filter((o) => o.holder && o.secrecy !== 'secret').map((o) => `${o.title} ${nm(w, o.holder)}`);
  if (ministers.length) L.push(`Ministers: ${ministers.join(', ')}.`);
  L.push(`Prosperity ${w.meters.prosperity} · Stability ${w.meters.stability} · Tax ${w.config.taxRate}% · Dividend ${w.config.dividend}`);
  const els = (Object.values(w.elections) as any[]).filter((e) => e.status === 'open');
  if (els.length) {
    L.push('');
    L.push('*Elections open*');
    els.forEach((e) => L.push(`• ${e.title}: ${Object.keys(e.candidates).length} standing, closes ${fmtTime(w, e.closesAt)}`));
  }
  const live = (Object.values(w.proposals) as any[]).filter((p) => ['debate', 'vote', 'assent', 'override', 'hos'].includes(p.stage)).sort((a, b) => (a.n || 0) - (b.n || 0));
  if (live.length) {
    L.push('');
    L.push('*Before the House*');
    live.forEach((p) => {
      const sets = (p.clauses || []).filter((c: any) => c.t === 'set' && SETTABLE[c.key]).map((c: any) => `${SETTABLE[c.key].label.toLowerCase()} ${typeof c.from === 'number' ? `${c.from}→` : '→'}${c.value}`);
      const stage = p.stage === 'debate' ? `debate, vote opens ${fmtTime(w, p.debateEndsAt)}` : p.stage === 'vote' ? `voting, closes ${fmtTime(w, p.voteEndsAt)}` : p.stage === 'assent' ? 'awaiting assent' : p.stage === 'override' ? 'veto override vote' : 'with the head of state';
      L.push(`• ${p.kind === 'bill' ? `Bill ${p.n}: ` : `${KINDS[p.kind]?.name}: `}${p.title} (${stage})${sets.length ? ` [${sets.join('; ')}]` : ''}`);
    });
  }
  const news = (w.gazette || []).filter((g: any) => !g.practice && g.kind !== 'admin').slice(0, 5);
  if (news.length) {
    L.push('');
    L.push('*Latest*');
    news.forEach((g: any) => L.push(`• ${g.text}`));
  }
  L.push('');
  L.push(`${w.laws.filter((l: any) => !l.repealed).length} laws in force.`);
  return L.join('\n');
}
