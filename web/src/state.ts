// "State stock": how the site looks once the realm is a dictatorship in all but name. On while a coup regime holds
// power, or while the Prime Minister rules by decree with no elections, or while there is only one legal party.
// Purely cosmetic: it reads the world and changes nothing in it.
import { nm, realmPlace, imperial } from '../../engine/index';
import { regnal } from '../../engine/crown';

const RULER: Record<string, string> = { martial: 'The Commander', junta: 'The Chairman of the junta', dictatorship: 'The Dictator', party: 'The Chairman of the Party' };
export type StateMode = { leader: string | null; title: string; realm: string; name: string; crown: boolean; maj: string };
// the Crown: a monarch who is also Prime Minister under the Crown Act, with no coup in the way
export const sovereign = (w: any) => !!w && w.phase === 'running' && !!w.acts?.crown && w.config.hos === 'monarchy' && !!w.pm && w.pm === w.hos?.holder && !(w.regime && w.regime.type !== 'civil') && !w.transition;
export function stateMode(w: any): StateMode | null {
  if (!w || w.phase !== 'running') return null;
  const r = w.regime;
  const a = w.acts || {};
  const coup = r && r.type !== 'civil';
  const crown = !!a.crown && !!w.pm && w.pm === w.hos?.holder;
  if (!coup && !(a.decrees && a.continuity) && !a.unity && !crown) return null;
  const leader = coup ? r.leader : w.pm || null;
  const title = coup ? (r.president ? 'The President' : RULER[r.type] || 'The Leader') : crown ? 'The ' + (w.config.hos === 'monarchy' ? w.config.hosTitle : 'President') : 'The Prime Minister';
  const place = realmPlace(w);
  const maj = `${/^(King|Emperor)$/.test(w.config.hosTitle) ? 'His' : 'Her'} ${imperial(w) ? 'Imperial ' : ''}Majesty`;
  if (sovereign(w)) return { leader, title: 'The Sovereign', realm: String(w.config.realmName || 'The Realm'), name: regnal(w) || nm(w, leader), crown: true, maj };
  return { leader, title, realm: `The State of ${place}`, name: leader ? nm(w, leader) : '', crown: false, maj };
}
export const leaderLine = (w: any) => {
  const s = stateMode(w);
  return s ? (s.crown ? `${s.realm} · By command of ${s.maj}` : `${s.realm} · By order of ${s.leader ? nm(w, s.leader) : 'the government'}`) : null;
};

// the band across the top of every page: the leader's name and the State's slogans, over and over
export function slogans(w: any): string[] {
  const s = stateMode(w);
  if (!s) return [];
  const who = s.leader ? nm(w, s.leader).toUpperCase() : 'THE STATE';
  const t = String(w.config.hosTitle || 'Queen').toUpperCase();
  const out = s.crown
    ? [`GOD SAVE THE ${t}`, `LONG LIVE ${s.name.toUpperCase()}`, 'ALL AUTHORITY IS VESTED IN THE CROWN', 'THE CROWN ANSWERS TO NO ONE']
    : [`LONG LIVE ${who}`, 'ORDER', 'UNITY', 'CONTINUITY'];
  if (w.acts?.continuity) out.push('THE PARLIAMENT SITS FOR EVER');
  if (w.acts?.unity) out.push('ONE PARTY · ONE REALM');
  if (w.acts?.jail) out.push('REPORT DISSENT');
  if (w.acts?.decrees) out.push(s.crown ? 'THE ROYAL DECREE IS THE LAW' : 'THE DECREE IS THE LAW');
  return out;
}
