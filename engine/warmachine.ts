// The war machine: how the realm pays for and equips its Army.
// - The Imperial War Chest (account 'warchest'): levies and protectorate tribute go into it while the Imperial
//   Prerogative Act is law; the High Commissioner can requisition from the Treasury (60 a week at most), trade shares
//   for it on the Exchange (holdings key 'warchest', public), and give money back.
// - Acquisitions of companies: holding CONTROL (25) shares gives the High Commissioner a director's powers over a company:
//   its order is 'dividends' (business as usual), 'war' (war production: a military benefit, WAR_USE, and the price
//   drifts down) or 'requisition' (its profits go to the war chest, and the price falls faster).
// - Military acquisitions (PROCUREMENT): artillery, cavalry, ironclads, airships, and forts in provinces. Bought by
//   the General, the High Commissioner or the PM, from the war chest if it can pay, else the Treasury. Upkeep weekly.
// State: w.warchest = { firms: {sym: {since, order, by}}, drawn, drawnWeek }, w.army.kit = {item: n}, province.fort.
import { hasArmy, W, Id, DAY, fail, nm, gazette, transfer, bal, hasPower, isPM, int, own, clamp, inForce } from './core';
import { exchange, price, company, halted, payOut, MAX_HOLD } from './exchange';
import { PROVINCES, seedProvinces, moodShift, atWar } from './foreign';

export const CHEST = 'warchest';
export const CONTROL = 25;
export const REQUISITION_CAP = 100;
const WEEK = 7 * DAY;

// who runs the war machine: the High Commissioner (imperial power), the General (army power), or the PM
export const canProcure = (w: W, id: Id) => hasPower(w, id, 'army') || hasPower(w, id, 'imperial') || isPM(w, id);
// who directs the war chest and its companies: the High Commissioner, or the PM while the post is empty or there is none
const hcHeld = (w: W) => Object.values(w.offices).some((o: any) => o.powers?.includes('imperial') && o.holder);
export const canDirect = (w: W, id: Id) => hasPower(w, id, 'imperial') || (isPM(w, id) && !hcHeld(w));
function mustDirect(w: W, actor: Id) {
  if (!canDirect(w, actor)) fail('Only the Imperial High Commissioner (or the Prime Minister, with nobody in the post) runs the war chest.');
}
export const chest = (w: W) => (w.warchest ??= { firms: {}, drawn: 0, drawnWeek: 0 });

// ---------- what a company does for the Army under war production ----------
export const WAR_USE: Record<string, { label: string; what: string; power?: number; advance?: number; regiment?: number; rations?: boolean; convoy?: boolean; finance?: number }> = {
  IRF: { label: 'Arms works', what: 'Regiments cost 10 instead of 15, and +1 Army strength.', power: 1, regiment: 10 },
  DSF: { label: 'Steel for guns', what: '+1 Army strength.', power: 1 },
  NGR: { label: 'Military railways', what: '+1.5 Army strength on the advance.', advance: 1.5 },
  HSC: { label: 'Army rations', what: 'The Army’s loyalty rises by 1 each week of war.', rations: true },
  VGC: { label: 'Grain for the front', what: 'The Army’s loyalty rises by 1 each week of war.', rations: true },
  KRS: { label: 'Convoys', what: 'Blockades seize half as many ships.', convoy: true },
  OFI: { label: 'Patrol boats', what: 'Blockades seize half as many ships.', convoy: true },
  TLM: { label: 'Uniforms and tents', what: '+0.5 Army strength.', power: 0.5 },
  CMB: { label: 'War loans', what: 'The war chest gets 8 crowns a week.', finance: 8 },
  AUT: { label: 'War finance', what: 'The war chest gets 8 crowns a week.', finance: 8 }
};
export const ORDERS: Record<string, string> = { dividends: 'Business as usual: dividends to the war chest.', war: 'War production: its military use, and the share price drifts down 3% a week.', requisition: 'Requisition: 15 crowns a week to the war chest, and the price falls 6% a week.' };
export const firms = (w: W) => Object.entries(w.warchest?.firms || {}) as [string, any][];
export const producing = (w: W) => firms(w).filter(([, f]) => f.order === 'war').map(([sym]) => sym);
const held = (w: W, sym: string) => exchange(w).holdings[CHEST]?.[sym]?.n || 0;

// ---------- the war chest ----------
export function requisition(w: W, actor: Id, crowns: unknown) {
  mustDirect(w, actor);
  const c = chest(w);
  const wk = Math.floor(w.now / WEEK);
  if (c.drawnWeek !== wk) (c.drawnWeek = wk), (c.drawn = 0);
  const n = int(crowns, 1, REQUISITION_CAP, 'crowns');
  if (c.drawn + n > REQUISITION_CAP) fail(`The war chest can draw ${REQUISITION_CAP} a week from the Treasury. ${REQUISITION_CAP - c.drawn} left this week.`);
  transfer(w, 'treasury', CHEST, n, 'Requisitioned for the war chest');
  c.drawn += n;
  gazette(w, 'money', `${nm(w, actor)} requisitions ${n} crowns from the Treasury for the war chest.`, '#/war');
}
export function giveBack(w: W, actor: Id, crowns: unknown) {
  mustDirect(w, actor);
  const n = int(crowns, 1, 10000, 'crowns');
  if (bal(w, CHEST) < n) fail(`The war chest holds ${bal(w, CHEST)}.`);
  transfer(w, CHEST, 'treasury', n, 'Returned from the war chest');
  gazette(w, 'money', `${n} crowns go back from the war chest to the Treasury.`, '#/war');
}

// ---------- shares and acquisitions ----------
export function trade(w: W, actor: Id, sym: unknown, n: unknown, sell: unknown) {
  mustDirect(w, actor);
  const co = typeof sym === 'string' ? company(sym) : undefined;
  if (!co) fail('Pick one of the ten companies on the Exchange.');
  if (halted(w)) fail('Trading is halted.');
  if (sell !== true && sell !== false) fail('Buy or sell.');
  const k = int(n, 1, MAX_HOLD, 'shares');
  const x = exchange(w);
  const h = (x.holdings[CHEST] ??= {});
  const p = price(w, co.sym);
  if (!sell) {
    if (co.nation && (w.nations[co.nation]?.embargo || atWar(w, co.nation))) fail(`${w.nations[co.nation].name}'s shares cannot be bought now.`);
    if ((h[co.sym]?.n || 0) + k > MAX_HOLD) fail(`The war chest can hold ${MAX_HOLD} of a company.`);
    const cost = Math.ceil(k * p);
    if (bal(w, CHEST) < cost) fail(`That costs ${cost}. The war chest holds ${bal(w, CHEST)}.`);
    transfer(w, CHEST, 'exchange', cost, `War chest bought ${k} ${co.sym}`);
    h[co.sym] = { n: (h[co.sym]?.n || 0) + k, cost: (h[co.sym]?.cost || 0) + cost };
    gazette(w, 'money', `The war chest buys ${k} shares of ${co.name}.`, '#/exchange');
    if ((h[co.sym].n >= CONTROL) && !chest(w).firms[co.sym]) takeControl(w, actor, co.sym);
    return;
  }
  const have = h[co.sym]?.n || 0;
  if (have < k) fail(`The war chest holds ${have} ${co.sym}.`);
  h[co.sym].cost -= Math.round((h[co.sym].cost * k) / have);
  h[co.sym].n -= k;
  if (!h[co.sym].n) delete h[co.sym];
  const got = Math.floor(k * p);
  if (got > 0) payOut(w, CHEST, got, `War chest sold ${k} ${co.sym}`);
  gazette(w, 'money', `The war chest sells ${k} shares of ${co.name}.`, '#/exchange');
  if (held(w, co.sym) < CONTROL && chest(w).firms[co.sym]) loseControl(w, co.sym);
}
// buy whatever is needed for control in one go, at a 20% premium
export function acquire(w: W, actor: Id, sym: unknown) {
  mustDirect(w, actor);
  const co = typeof sym === 'string' ? company(sym) : undefined;
  if (!co) fail('Pick one of the ten companies on the Exchange.');
  if (chest(w).firms[co.sym]) fail(`We already control ${co.name}.`);
  if (halted(w)) fail('Trading is halted.');
  if (co.nation && (w.nations[co.nation]?.embargo || atWar(w, co.nation))) fail(`${w.nations[co.nation].name}'s companies cannot be bought now.`);
  const need = CONTROL - held(w, co.sym);
  const cost = Math.ceil(need * price(w, co.sym) * 1.2);
  if (bal(w, CHEST) < cost) fail(`A controlling stake costs ${cost} (${need} shares and a 20% premium). The war chest holds ${bal(w, CHEST)}.`);
  transfer(w, CHEST, 'exchange', cost, `Acquisition of ${co.name}`);
  const h = (exchange(w).holdings[CHEST] ??= {});
  h[co.sym] = { n: (h[co.sym]?.n || 0) + need, cost: (h[co.sym]?.cost || 0) + cost };
  exchange(w).prices[co.sym].p = Math.round(exchange(w).prices[co.sym].p * 1.08 * 100) / 100;
  takeControl(w, actor, co.sym);
  if (co.nation) moodShift(w.nations[co.nation], -1, `We bought up ${co.name}`);
}
function takeControl(w: W, actor: Id, sym: string) {
  chest(w).firms[sym] = { since: w.now, order: 'dividends', by: actor };
  gazette(w, 'money', `Acquisition: the war chest takes control of ${company(sym)!.name}. The Imperial High Commission now directs it.`, '#/war', { k: 'acquire', by: actor, title: company(sym)!.name });
}
function loseControl(w: W, sym: string) {
  delete chest(w).firms[sym];
  gazette(w, 'money', `The war chest no longer controls ${company(sym)!.name}.`, '#/war');
}
// a director's order for a company the war chest controls
export function direct(w: W, actor: Id, sym: unknown, order: unknown) {
  mustDirect(w, actor);
  const f = typeof sym === 'string' ? own(chest(w).firms, sym) : null;
  if (!f) fail('The war chest does not control that company.');
  if (!own(ORDERS, order)) fail('Order dividends, war production or requisition.');
  if (f.order === order) fail('That is already its order.');
  f.order = order;
  const co = company(sym as string)!;
  gazette(w, 'money', order === 'war' ? `${co.name} turns to war production: ${WAR_USE[co.sym]?.label.toLowerCase() || 'supplies for the Army'}.` : order === 'requisition' ? `${co.name}'s profits are requisitioned for the war chest.` : `${co.name} goes back to business as usual.`, '#/war', order === 'war' ? { k: 'production', by: actor, title: co.name } : undefined);
}

// ---------- military acquisitions ----------
export const PROCUREMENT: Record<string, { name: string; cost: number; upkeep: number; max: number; what: string; power?: number }> = {
  artillery: { name: 'Artillery battery', cost: 40, upkeep: 2, max: 4, power: 1, what: '+1 Army strength each.' },
  cavalry: { name: 'Cavalry squadron', cost: 25, upkeep: 1, max: 4, power: 0.5, what: '+0.5 strength each; raids bring back half as much again.' },
  ironclad: { name: 'Ironclad', cost: 60, upkeep: 3, max: 3, power: 0.5, what: 'A navy at last: each one cuts the ships lost to blockades by a third. +0.5 strength.' },
  airship: { name: 'Airship', cost: 50, upkeep: 2, max: 2, power: 0.5, what: 'We can see every nation’s army. +0.5 strength.' },
  fort: { name: 'Fort', cost: 35, upkeep: 1, max: 1, what: 'Built in a province we hold: it rarely rises, and +0.5 strength when we hold the line.' }
};
export const kit = (w: W) => (w.army.kit ??= {});
const payFor = (w: W, amt: number, memo: string) => {
  if (bal(w, CHEST) >= amt) return (transfer(w, CHEST, 'reserve', amt, memo), 'the war chest');
  transfer(w, 'treasury', 'reserve', amt, memo);
  return 'the Treasury';
};
export function procure(w: W, actor: Id, item: unknown, province: unknown) {
  if (!hasArmy(w)) fail('There is no Army: pass the Defence Act first.');
  if (!canProcure(w, actor)) fail('Only the General, the High Commissioner or the Prime Minister buys for the Army.');
  const p = own(PROCUREMENT, item);
  if (!p) fail('Pick artillery, cavalry, an ironclad, an airship or a fort.');
  let where = '';
  if (item === 'fort') {
    seedProvinces(w);
    const pr = own(w.provinces, province);
    if (!pr || pr.owner !== 'realm') fail('Build a fort in a province we hold.');
    if (pr.fort) fail('There is already a fort there.');
    pr.fort = true;
    where = ` in ${PROVINCES[province as string].name}`;
  } else {
    const k = kit(w);
    if ((k[item as string] || 0) >= p.max) fail(`The Army can have ${p.max} at most.`);
    k[item as string] = (k[item as string] || 0) + 1;
  }
  const from = payFor(w, p.cost, `${p.name}${where}`);
  gazette(w, 'army', `Military acquisition: ${/^[aeiou]/i.test(p.name) ? 'an' : 'a'} ${p.name.toLowerCase()}${where}, ${p.cost} crowns from ${from}.`, '#/war', { k: 'procure', by: actor, title: p.name, item: item as string, place: where.replace(/^ in /, '') || null });
}
export function scrap(w: W, actor: Id, item: unknown, province: unknown) {
  if (!canProcure(w, actor)) fail('Only the General, the High Commissioner or the Prime Minister can do that.');
  const p = own(PROCUREMENT, item);
  if (!p) fail('Pick something the Army has.');
  if (item === 'fort') {
    const pr = own(w.provinces || {}, province);
    if (!pr?.fort) fail('There is no fort there.');
    pr.fort = false;
  } else {
    const k = kit(w);
    if (!k[item as string]) fail('The Army has none.');
    k[item as string] -= 1;
  }
  gazette(w, 'army', `The Army stands down ${/^[aeiou]/i.test(p.name) ? 'an' : 'a'} ${p.name.toLowerCase()}.`, '#/war');
}

// ---------- what it all adds to the Army in battle (war.ts power() reads this) ----------
export function machineLines(w: W, strategy: string): [string, number][] {
  const out: [string, number][] = [];
  const k = w.army?.kit || {};
  const many: Record<string, string> = { artillery: 'artillery batteries', cavalry: 'cavalry squadrons', ironclad: 'ironclads', airship: 'airships' };
  Object.entries(PROCUREMENT).forEach(([id, p]) => p.power && k[id] > 0 && out.push([`${k[id]} ${k[id] === 1 ? p.name.toLowerCase() : many[id]}`, k[id] * p.power]));
  if (id_forts(w) && strategy === 'hold') out.push([`Forts (${id_forts(w)})`, 0.5]);
  producing(w).forEach((sym) => {
    const u = WAR_USE[sym];
    if (!u) return;
    const v = (u.power || 0) + (strategy === 'advance' ? u.advance || 0 : 0);
    if (v) out.push([`${company(sym)!.name}: ${u.label.toLowerCase()}`, v]);
  });
  return out;
}
const id_forts = (w: W) => Object.values(w.provinces || {}).filter((p: any) => p.owner === 'realm' && p.fort).length;
export const regimentCost = (w: W, base: number) => (producing(w).some((s) => WAR_USE[s]?.regiment) ? 10 : base);
export const blockadeFactor = (w: W) => Math.max(0, 1 - (w.army?.kit?.ironclad || 0) / 3) * (producing(w).some((s) => WAR_USE[s]?.convoy) ? 0.5 : 1);
export const raidBonus = (w: W) => 1 + 0.5 * Math.min(1, w.army?.kit?.cavalry || 0);
export const airships = (w: W) => (w.army?.kit?.airship || 0) > 0;

// ---------- once a week ----------
export function machineWeek(w: W) {
  if (!w.army) return;
  // upkeep
  const k = w.army.kit || {};
  const up = Object.entries(PROCUREMENT).reduce((s, [id, p]) => s + (id === 'fort' ? id_forts(w) : k[id] || 0) * p.upkeep, 0);
  if (up > 0) payFor(w, up, 'Upkeep of the Army’s equipment');
  // the companies the war chest directs
  const x = w.exchange;
  firms(w).forEach(([sym, f]) => {
    if (!x?.prices?.[sym] || held(w, sym) < CONTROL) return void delete w.warchest.firms[sym];
    const u = WAR_USE[sym];
    if (f.order === 'war') {
      x.prices[sym].p = Math.max(0.5, Math.round(x.prices[sym].p * 0.97 * 100) / 100);
      if (u?.rations && w.army.campaign) (w.army.loyalty = clamp((w.army.loyalty ?? 3) + 1, 0, 5));
      if (u?.finance) transfer(w, 'reserve', CHEST, u.finance, `${company(sym)!.name}: war loans`);
    }
    if (f.order === 'requisition') {
      x.prices[sym].p = Math.max(0.5, Math.round(x.prices[sym].p * 0.94 * 100) / 100);
      payOut(w, CHEST, 15, `${company(sym)!.name}'s profits, requisitioned`);
    }
  });
}
// what the levy and tribute pay into: the war chest under the Imperial Prerogative Act, else the Treasury
export const imperialPurse = (w: W) => (inForce(w, 'imperial') ? CHEST : 'treasury');
