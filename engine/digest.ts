// The state of the realm as plain text, ready to paste into the group chat. Reads public things only (who holds
// which public office, what's open, the numbers), so it's the same from a player's view or the full world.
// The site's Copy button and the server's /api/public/digest.txt both use this.
import { W, Id, DAY, nm, fmtTime, fmtDay, ordinal, hosTitle, majority } from './core';
import { crisisById } from './crises';
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

// The week in one card: what passed, who rebelled, who's up. Public things only, so it reads the same from any view.
export type Recap = {
  from: number; to: number; laws: { ref: string; title: string }[]; defeated: number; tabled: number;
  rebel: { id: Id; n: number } | null; loudest: { id: Id; n: number } | null; top: { id: Id; n: number } | null;
  pm: { id: Id; approval: number } | null; meters: { key: string; now: number; d: number }[];
  elections: { title: string; winners: Id[] }[]; crises: string[];
};
export function recap(w: W, to = w.now): Recap {
  const from = to - 7 * DAY;
  const inWeek = (t: any) => typeof t === 'number' && t > from && t <= to;
  const props = Object.values(w.proposals) as any[];
  const laws = w.laws.filter((l: any) => !l.classified && inWeek(l.at)).map((l: any) => ({ ref: l.ref, title: l.title }));
  const closed = props.filter((p) => p.result && !p.result.withdrawn && inWeek(p.voteEndsAt));
  const tally = (pairs: Id[]) => { const n: Record<string, number> = {}; pairs.forEach((id) => (n[id] = (n[id] || 0) + 1)); const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0]; return best ? { id: best[0], n: best[1] } : null; };
  const rebel = tally(closed.flatMap((p) => p.rebels || []));
  const loudest = tally(props.flatMap((p) => (p.speeches || []).filter((s: any) => inWeek(s.at) && s.side !== 'order').map((s: any) => s.by)));
  const people = (Object.values(w.citizens) as any[]).filter((c) => c.active && !c.bot);
  const best = people.sort((a, b) => b.influence - a.influence)[0];
  const meters = ['prosperity', 'stability'].map((key) => ({ key, now: w.meters[key], d: (w.meters.log || []).filter((l: any) => l.key === key && inWeek(l.at)).reduce((a: number, l: any) => a + l.d, 0) }));
  const elections = (Object.values(w.elections) as any[]).filter((e) => e.status === 'closed' && inWeek(e.closedAt) && e.results).map((e) => ({ title: e.title, winners: e.results.winners }));
  const crises = (Object.values(w.crises || {}) as any[]).filter((c) => c.status === 'decided' && inWeek(c.decidedAt)).map((c) => crisisById(c.type)?.title || 'A crisis');
  return {
    from, to, laws, defeated: closed.filter((p) => !p.result.passed).length, tabled: props.filter((p) => inWeek(p.at)).length,
    rebel, loudest, top: best ? { id: best.id, n: best.influence } : null,
    pm: w.pm && w.citizens[w.pm] ? { id: w.pm, approval: w.citizens[w.pm].approval } : null, meters, elections, crises
  };
}
export function recapText(w: W, r = recap(w)): string {
  const L: string[] = [`*${w.config.realmName}: the week to ${fmtDay(r.to)}*`, ''];
  L.push(r.laws.length ? `📜 ${r.laws.length} new law${r.laws.length > 1 ? 's' : ''}: ${r.laws.map((l) => `${l.title} (${l.ref})`).join(', ')}.` : '📜 No new laws.');
  L.push(`🗳 ${r.tabled} tabled, ${r.defeated} defeated.`);
  r.elections.forEach((e) => L.push(`🏛 ${e.title}: ${e.winners.map((x) => nm(w, x)).join(', ') || 'no winner'}.`));
  r.crises.forEach((c) => L.push(`⚠ Crisis handled: ${c}.`));
  if (r.rebel) L.push(`😈 Biggest rebel: ${nm(w, r.rebel.id)} (${r.rebel.n} vote${r.rebel.n > 1 ? 's' : ''} against the whip).`);
  if (r.loudest) L.push(`📣 Loudest in the House: ${nm(w, r.loudest.id)} (${r.loudest.n} speech${r.loudest.n > 1 ? 'es' : ''}).`);
  if (r.top) L.push(`⭐ Most influential: ${nm(w, r.top.id)} (${r.top.n} Influence).`);
  if (r.pm) L.push(`👔 PM ${nm(w, r.pm.id)}: ${r.pm.approval}% approval.`);
  L.push(r.meters.map((m) => `${m.key === 'prosperity' ? 'Prosperity' : 'Stability'} ${m.now} (${m.d >= 0 ? '+' : ''}${m.d})`).join(' · '));
  return L.join('\n');
}
