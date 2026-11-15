// "State stock": how the site looks once the realm is a dictatorship in all but name. On while a coup regime holds
// power, or while the Prime Minister rules by decree with no elections, or while there is only one legal party.
// Purely cosmetic: it reads the world and changes nothing in it.
import { nm } from '../../engine/index';

const RULER: Record<string, string> = { martial: 'The Commander', junta: 'The Chairman of the junta', dictatorship: 'The Dictator', party: 'The Chairman of the Party' };
export function stateMode(w: any): { leader: string | null; title: string; realm: string } | null {
  if (!w || w.phase !== 'running') return null;
  const r = w.regime;
  const a = w.acts || {};
  const coup = r && r.type !== 'civil';
  if (!coup && !(a.decrees && a.continuity) && !a.unity) return null;
  const leader = coup ? r.leader : w.pm || null;
  const title = coup ? (r.president ? 'The President' : RULER[r.type] || 'The Leader') : 'The Prime Minister';
  const place = String(w.config.realmName || 'the Realm').split(' of ')[1] || 'the Realm';
  return { leader, title, realm: `The State of ${place}` };
}
export const leaderLine = (w: any) => {
  const s = stateMode(w);
  return s ? `${s.realm} · By order of ${s.leader ? nm(w, s.leader) : 'the government'}` : null;
};

// the band across the top of every page: the leader's name and the State's slogans, over and over
export function slogans(w: any): string[] {
  const s = stateMode(w);
  if (!s) return [];
  const who = s.leader ? nm(w, s.leader).toUpperCase() : 'THE STATE';
  const out = [`LONG LIVE ${who}`, 'ORDER', 'UNITY', 'CONTINUITY'];
  if (w.acts?.continuity) out.push('THE PARLIAMENT SITS FOR EVER');
  if (w.acts?.unity) out.push('ONE PARTY · ONE REALM');
  if (w.acts?.jail) out.push('REPORT DISSENT');
  if (w.acts?.decrees) out.push('THE DECREE IS THE LAW');
  return out;
}
