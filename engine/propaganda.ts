// Posters on the walls (the designs themselves live in web/src/posters.ts; the engine only knows their ids).
// - When a war starts, its first poster goes up in the Gazette (war.ts sets g.poster on the entry).
// - The enemy puts up its own posters; defectors at its court sign them (k.enemyPosters on the campaign, public).
// - The Imperial High Commissioner (or the PM with none) commissions a poster with a slogan of its own: 10 from their
//   own purse, up for three days, on every page (w.commission, public).
// - Under a coup regime, resisters scrawl over the posters: legitimacy −1, and a chance of being caught and held for a
//   day. What is written is public; who wrote it is secret unless caught (w.defaced[poster][].by, stripped in view.ts).
import { W, Id, DAY, fail, meter, cit, nm, gazette, transfer, ca, bal, chance, clamp, legit, mustBeFree, text, bump, isPM } from './core';
import { canGovernEmpire } from './empire';

export const POSTER_IDS = ['lend', 'march', 'cannon', 'calls', 'firm', 'eagle', 'waves', 'skies', 'horse', 'fields', 'silence', 'forge', 'fallen', 'kess-cross', 'kess-gold', 'kess-valley', 'decree'];
export const ENEMY_POSTER_IDS = ['gohome', 'unbroken'];
export const POSTER_FONTS = ['imperial', 'propaganda', 'condensed', 'gothic', 'fatface', 'slab', 'classic'];
export const POSTER_PALETTES = ['porphyry', 'khaki', 'navy', 'blood', 'realm', 'steel'];
// the first poster of a war: the realm's own for that enemy if it has one
export const warPoster = (nid: string) => (nid === 'kessmark' ? 'kess-cross' : 'march');
// a poster pinned to a story (press.submit, exile.write, press.underground): any of the realm's, the enemy's in wartime,
// or the High Commission's while it is up (its slogan is copied, so the story keeps it after the poster comes down)
export function posterRef(w: W, v: unknown) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') fail('Pick a poster.');
  if (v === 'decree') {
    const c = w.commission;
    if (!c || c.until <= w.now) fail('The commissioned poster is not up any more.');
    return { id: 'decree', slogan: c.slogan, by: c.by, font: c.font, pal: c.pal };
  }
  if (ENEMY_POSTER_IDS.includes(v)) return w.army?.war ? { id: v, enemy: w.army.war } : fail('There is no enemy putting up posters.');
  return POSTER_IDS.includes(v) ? { id: v } : fail('Pick a poster.');
}
export const COMMISSION_COST = 10;
export const COMMISSION_DAYS = 3;

export function commission(w: W, actor: Id, slogan: unknown, font: unknown, pal: unknown) {
  if (!canGovernEmpire(w, actor) && !isPM(w, actor)) fail('Only the Imperial High Commissioner (or the Prime Minister) commissions posters.');
  mustBeFree(w, actor);
  const s = text(slogan, 6, 48, 'slogan');
  const f = font === undefined || font === null || font === '' ? 'imperial' : POSTER_FONTS.includes(font as string) ? (font as string) : fail('Pick a typeface.');
  const p = pal === undefined || pal === null || pal === '' ? 'porphyry' : POSTER_PALETTES.includes(pal as string) ? (pal as string) : fail('Pick a palette.');
  if (w.commission && w.commission.by === actor && w.now - w.commission.at < DAY) fail('One poster a day.');
  if (bal(w, ca(actor)) < COMMISSION_COST) fail(`A poster run costs ${COMMISSION_COST} from your own purse.`);
  transfer(w, ca(actor), 'reserve', COMMISSION_COST, 'Printing a poster');
  w.commission = { by: actor, slogan: s, font: f, pal: p, at: w.now, until: w.now + COMMISSION_DAYS * DAY };
  w.defaced = { ...(w.defaced || {}), decree: [] };
  bump(w, actor, 'posters');
  gazette(w, 'government', `New posters go up across the realm, by order of ${nm(w, actor)}: “${s}”`, '#/war');
  w.gazette[0].poster = { id: 'decree', slogan: s, by: actor, font: f, pal: p };
}

export function deface(w: W, actor: Id, poster: unknown, words: unknown) {
  const r = w.regime;
  if (!r || r.type === 'civil') fail('Only a regime’s posters are worth the risk. There is no regime.');
  if (r.leader === actor || (r.council || []).includes(actor)) fail('You cannot deface your own propaganda.');
  mustBeFree(w, actor);
  if (cit(w, actor).defected) fail('You are abroad.');
  if (typeof poster !== 'string' || !POSTER_IDS.includes(poster)) fail('Pick a poster.');
  const s = text(words, 2, 30, 'scrawl');
  w.defaced ??= {};
  const mine = Object.values(w.defaced).flat().filter((x: any) => x.by === actor && w.now - x.at < DAY);
  if (mine.length) fail('Once a day. The patrols are watching the walls.');
  w.defaced[poster] = [{ text: s, by: actor, at: w.now }, ...(w.defaced[poster] || [])].slice(0, 3);
  legit(w, -1, 'Posters defaced');
  bump(w, actor, 'defaced');
  if (chance(w, clamp(0.25, 0, 1))) {
    const c = w.citizens[actor];
    c.detainedUntil = w.now + DAY;
    c.detainedNoted = false;
    w.defaced[poster][0].caught = true;
    return gazette(w, 'crisis', `${nm(w, actor)} is caught scrawling “${s}” over a regime poster, and is held for a day.`, '#/war');
  }
  gazette(w, 'crisis', `Someone has scrawled “${s}” over the regime's posters.`, '#/war');
}

// a defector at the enemy's court puts their name to its propaganda: favour at court, unease at home
export function signEnemyPoster(w: W, actor: Id, poster: unknown) {
  const d = w.citizens[actor]?.defected;
  const k = w.army?.campaign;
  if (!d || !k || d.nation !== w.army.war) fail('Only a defector at the court of the enemy signs its posters.');
  if (typeof poster !== 'string' || !ENEMY_POSTER_IDS.includes(poster)) fail('Pick one of their posters.');
  k.enemyPosters ??= {};
  const list = (k.enemyPosters[poster] ??= []);
  if (list.includes(actor)) fail('Your name is already on it.');
  if (d.last?.sign && w.now - d.last.sign < DAY) fail('One signature a day.');
  d.last.sign = w.now;
  list.push(actor);
  d.favour = clamp(d.favour + 3, 0, 100);
  d.deeds = [{ at: w.now, what: `Signed ${w.nations[k.nation].name}'s war posters` }, ...(d.deeds || [])].slice(0, 20);
  gazette(w, 'scandal', `${nm(w, actor)} puts their name to ${w.nations[k.nation].name}'s war posters.`, '#/war');
  meter(w, 'stability', -1, 'A defector signed the enemy’s posters');
}
