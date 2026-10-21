// Every hat you wear in the realm, with what it lets you do and where to do it. Today's "Your desk", the role chips
// in the sidebar and on your Passport, and the "new job" notice all read this list.
import { isMP, isPM, isHOS, hosTitle, officesOf } from '../../engine/index';
import { leaderOfOpposition } from '../../engine/politics';
import { POWERS } from '../../engine/offices';

export type Role = { key: string; title: string; tone: 'red' | 'teal' | 'brown' | 'ink'; href: string; can: string[] };

export function rolesOf(w: any, me: string): Role[] {
  const c = w.citizens[me];
  if (!c) return [];
  const R: Role[] = [];
  if (isPM(w, me)) R.push({ key: 'pm', title: 'Prime Minister', tone: 'red', href: '#/government', can: ['Appoint and sack ministers', 'Answer at Prime Minister’s Questions', 'Decide crises for the realm', 'Table government bills'] });
  if (isHOS(w, me)) R.push({ key: 'hos', title: hosTitle(w), tone: 'red', href: '#/hos', can: ['Sign or refuse bills the House has passed', 'Invite whoever commands a majority to be Prime Minister'] });
  if (w.speaker === me) R.push({ key: 'speaker', title: 'Speaker', tone: 'ink', href: '#/house', can: ['Call order in debates', 'Cast the deciding vote on a tie'] });
  if (isMP(w, me)) R.push({ key: 'mp', title: 'Member of Parliament', tone: 'teal', href: '#/house', can: ['Vote on every bill', 'Table bills and ask questions', 'Back or bring down the government'] });
  try {
    if (leaderOfOpposition(w) === me) R.push({ key: 'lo', title: 'Leader of the Opposition', tone: 'brown', href: '#/government', can: ['Name the shadow cabinet', 'Lead the questions at PMQs'] });
  } catch {}
  officesOf(w, me).forEach((o: any) => R.push({ key: 'o:' + o.id, title: o.title, tone: 'ink', href: '#/office/' + o.id, can: o.powers.map((p: string) => POWERS[p]?.label).filter(Boolean) }));
  const party = c.party && w.parties[c.party];
  if (party?.status === 'active' && party.leader === me) R.push({ key: 'pl:' + party.id, title: `Leader, ${party.name}`, tone: 'brown', href: '#/party/' + party.id, can: ['Pick the party’s candidates and line', 'Lead coalition talks'] });
  (Object.values(w.elections) as any[]).filter((e) => e.status === 'open' && e.candidates?.[me]).forEach((e) => R.push({ key: 'cand:' + e.id, title: `Standing: ${e.title}`, tone: 'teal', href: '#/election/' + e.id, can: ['Campaign until the polls close'] }));
  if (c.admin) R.push({ key: 'ro', title: 'Returning Officer', tone: 'red', href: '#/admin', can: ['Approve sign-ups and invitations', 'Pause the clock and keep the realm running'] });
  return R;
}

// the roles you hadn't got last time this device looked, so Today can say "You're now…"
const KEY = (me: string) => 'realm-roles-' + me;
export function newRoles(roles: Role[], me: string): Role[] {
  try {
    const raw = localStorage.getItem(KEY(me));
    if (raw === null) {
      localStorage.setItem(KEY(me), JSON.stringify(roles.map((r) => r.key)));
      return [];
    }
    const had: string[] = JSON.parse(raw);
    return roles.filter((r) => !had.includes(r.key) && !r.key.startsWith('cand:'));
  } catch {
    return [];
  }
}
export function noteRoles(roles: Role[], me: string) {
  try { localStorage.setItem(KEY(me), JSON.stringify(roles.map((r) => r.key))); } catch {}
}
