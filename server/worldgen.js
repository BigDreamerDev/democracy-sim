/* A world, generated.

   Unclaimed ground becomes plausible neighbours: named for where they are,
   shaped like they grew rather than like they were cut, and sized so that one of
   them can beat the Republic, one of them cannot, and the rest are an argument.

   Four rules decide everything below, and they are the whole design.

   **Power first, territory second.** The distribution of strength is chosen
   before a single piece of land is handed out. Do it the other way round and
   geography quietly decides politics — whoever happened to be seeded next to a
   big continent becomes the great power, and the world is interesting by
   accident or not at all. So: the Republic's own strength is read out of
   `war.js`, every neighbour is expressed as a multiple of it, and only then is
   the map asked to satisfy those numbers.

   The exchange rate between land and strength is derived, not fixed. Once the
   capitals are seeded we know how much output is actually within reach of them;
   the rate is set so the budgets add up to a share of exactly that. The budget
   is therefore satisfiable by construction rather than by hope, and the leftover
   share is what leaves genuine gaps in the world.

   **Strength comes out of the ground.** A power's `strength` is its land's
   notional output times a rate frozen when it was generated. Take a province off
   it and it is weaker, by arithmetic, without anybody deciding so. That is the
   entire reason for having a map.

   And it never rubber-bands. When the Republic's strength moves, the rate stays
   where it was: `/api/world/strength/recompute` re-reads the LAND, not the
   Republic. A neighbour that got stronger because we did is the thing players
   spot immediately and stop caring about.

   **Grow, do not partition.** Voronoi over random seeds gives convex polygons
   that look like a diagram. Real borders are grown and then stopped by
   something. So capitals are seeded apart, and each nation repeatedly takes the
   cheapest piece next to what it already holds — cost rising with distance from
   its capital, falling along a shared coast, tripling across open water. That
   alone produces the long coastal states and the blobby interior ones that read
   as real.

   **Nothing recognises itself.** The powers arrive unrecognised, every one, and
   the map draws them dashed until the House passes a recognition bill. That is
   not a defect to be smoothed over on day one; it is the first decision the
   House gets to make about the world, and every response here says so out loud.

   Generated on the server, stored, and only ever shipped as the stored result. A
   client-side generator hands every player the seed and the algorithm, and a
   world you can re-roll in the console is not a world.

   Nothing here is random in the sense `war.js` refuses. It is *seeded*: the same
   seed produces the same world on any machine, which is what lets the Returning
   Officer preview one, look at it, and commit it — or throw it away and try
   another. No world goes live unseen. */

'use strict';

const atlas = require('./worldatlas');

/* ------------------------------------------------------------ determinism */

/* xmur3 + sfc32. A stored seed has to reproduce a world exactly, on any machine
   and any Node version, so Math.random cannot appear anywhere below. */
function hash32(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

function rng(seed) {
  let a = hash32(seed + ':a'), b = hash32(seed + ':b'), c = hash32(seed + ':c'), d = hash32(seed + ':d');
  return function next() {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/* A wobble that depends only on what it is about, never on when it was asked
   for. The growth loop offers pieces in an order that shifts as nations take
   them; a jitter drawn from a running generator would make the same seed produce
   a different world on a machine that scheduled one query differently. */
const jitter = (seed, key) => hash32(`${seed}|${key}`) / 4294967296;

/* --------------------------------------------------------------- naming */

/* Names are built from a per-region syllable table so that neighbours sound like
   each other, and the region is (latitude band x longitude sector) — which is
   the closest thing to "somewhere in particular" this projection can honestly
   give us. Every table below is invented. None of it is a list of real places,
   and what stops a real place falling out of the combinations is the filter
   underneath, not the tables. */

const BANDS = [
  { key: 'boreal', from: 55 },
  { key: 'northern', from: 23 },
  { key: 'equatorial', from: -23 },
  { key: 'southern', from: -55 },
  { key: 'austral', from: -91 }
];
const bandOf = lat => (BANDS.find(b => lat >= b.from) || BANDS[BANDS.length - 1]).key;

const SYLLABLES = {
  boreal: {
    heads: ['Skar', 'Vorn', 'Thal', 'Bry', 'Gnos', 'Hjal', 'Kral', 'Sten', 'Fjor', 'Drav', 'Tors', 'Svel', 'Myr', 'Ryke'],
    mids: ['a', 'o', 'en', 'ia', 'u', 'er', 'yn'],
    coastal: ['vik', 'fjard', 'strand', 'holm', 'naes', 'sund', 'oer'],
    interior: ['mark', 'heim', 'vald', 'borg', 'gard', 'hult', 'rike']
  },
  northern: {
    heads: ['Val', 'Kar', 'Ter', 'Mor', 'Sel', 'Bran', 'Dor', 'Lem', 'Ost', 'Rus', 'Kal', 'Vin', 'Pral', 'Ard', 'Gel', 'Tesh'],
    mids: ['a', 'o', 'i', 'en', 'ov', 'esh', 'ar', 'ul'],
    coastal: ['mere', 'porth', 'wyck', 'haven', 'bais', 'strand', 'quay'],
    interior: ['land', 'mora', 'vasta', 'stad', 'grad', 'burgh', 'veld', 'thal']
  },
  equatorial: {
    heads: ['Zan', 'Kim', 'Bara', 'Oku', 'Tan', 'Ife', 'Mal', 'Cara', 'Nya', 'Tepa', 'Ubo', 'Sira', 'Ando', 'Yem', 'Jala'],
    mids: ['a', 'i', 'u', 'wa', 'na', 'le', 'ri', 'ko'],
    coastal: ['mbo', 'kwa', 'pura', 'tola', 'reva', 'mara', 'sela'],
    interior: ['dara', 'veni', 'sasa', 'kul', 'anga', 'beni', 'toro', 'zuma']
  },
  southern: {
    heads: ['Sur', 'Alta', 'Pam', 'Vera', 'Quil', 'Mira', 'Tala', 'Nuvo', 'Ceri', 'Bala', 'Ruma', 'Enca'],
    mids: ['a', 'i', 'en', 'ar', 'os', 'ua'],
    coastal: ['mara', 'porta', 'cala', 'riba', 'vista', 'banda'],
    interior: ['pampa', 'llano', 'monte', 'vado', 'campa', 'seco', 'terra']
  },
  austral: {
    heads: ['Glac', 'Aus', 'Thu', 'Wind', 'Kel', 'Fros', 'Nim', 'Ober'],
    mids: ['a', 'o', 'en', 'ir'],
    coastal: ['skerry', 'floe', 'reach', 'cove'],
    interior: ['waste', 'fell', 'scarp', 'moor']
  }
};

/* Names the atlas does not carry and a player would still recognise instantly:
   historic states, the big demonyms, the ones a syllable table can stumble into.
   The filter refuses anything that resembles one of these too. */
const ALSO_REAL = [
  'America', 'Britain', 'Britannia', 'England', 'Scotland', 'Wales', 'Persia', 'Prussia',
  'Rome', 'Roman', 'Sparta', 'Athens', 'Byzantium', 'Ottoman', 'Soviet', 'Russia',
  'Arabia', 'Siam', 'Burma', 'Ceylon', 'Rhodesia', 'Zaire', 'Yugoslavia', 'Bohemia',
  'Prussian', 'Anglia', 'Iberia', 'Gaul', 'Francia', 'Batavia', 'Bavaria', 'Saxony',
  'Nippon', 'Cathay', 'Formosa', 'Levant', 'Nubia', 'Carthage', 'Assyria', 'Babylon',
  'Scandinavia', 'Balkans', 'Patagonia', 'Amazonia', 'Sahara', 'Siberia', 'Anatolia',
  'Mesopotamia', 'Andalusia', 'Catalonia', 'Lombardy', 'Tuscany', 'Normandy', 'Brittany',
  'Antarctica', 'Australasia', 'Polynesia', 'Micronesia', 'Melanesia', 'Eurasia', 'Africa',
  'Asia', 'Europe', 'Oceania', 'Atlantis', 'Utopia'
];

/* Diacritics are stripped before comparison, or "Bādghīs" and "Badghis" would be
   two different names and only one of them would be refused. */
const normalise = s => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z]/g, '');

/* Bounded Levenshtein: it stops as soon as every cell in a row is already past
   the limit, so a candidate that is nothing like a real name costs two rows
   rather than a full matrix. */
function within(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (row[j] < best) best = row[j];
    }
    if (best > max) return false;
    prev = row;
  }
  return prev[b.length] <= max;
}

let FILTER;
/* Built once. `exact` is every real name normalised; `byLength` lets the edit
   distance check look only at names of a plausible length; `containers` lets the
   "is my invention hiding inside a real name" check look only at names long
   enough to hide it. */
function filter() {
  if (FILTER) return FILTER;
  const all = [...atlas.realNames(), ...ALSO_REAL].map(normalise).filter(n => n.length >= 3);
  const exact = new Set(all);
  const byLength = new Map();
  for (const n of exact) {
    if (!byLength.has(n.length)) byLength.set(n.length, []);
    byLength.get(n.length).push(n);
  }
  FILTER = { exact, byLength, size: exact.size };
  return FILTER;
}

/* A generated name has failed if a player could look at it and think of a real
   place. Four ways that happens, and all four are refused:

     it IS one                          "Norway"
     it CONTAINS one                    "Norwaya"   <- the stated failure
     one contains IT                    "Orway" inside "Norway"
     it is a typo away from one         "Norwey"

   Deliberately strict. Rejecting too much costs a few more attempts; letting one
   through costs the conceit, permanently. */
function looksReal(name) {
  const c = normalise(name);
  if (c.length < 4) return true;
  const f = filter();
  if (f.exact.has(c)) return true;

  for (let len = 4; len <= c.length; len++) {
    for (let i = 0; i + len <= c.length; i++) {
      if (len === c.length && i === 0) continue;    // that is the exact test above
      if (f.exact.has(c.slice(i, i + len))) return true;
    }
  }

  for (let len = c.length; len <= c.length + 4; len++) {
    for (const n of f.byLength.get(len) || []) if (n.includes(c)) return true;
  }

  const max = c.length <= 6 ? 1 : 2;
  for (let len = c.length - max; len <= c.length + max; len++) {
    for (const n of f.byLength.get(len) || []) if (within(c, n, max)) return true;
  }
  return false;
}

/* Every region draws from a small slice of its band's table rather than the
   whole of it, so two nations in the same corner of the world share syllables
   and read as neighbours instead of as two unrelated dice rolls. */
function regionTable(seed, band, sector) {
  const r = rng(`${seed}|region|${band}|${sector}`);
  const src = SYLLABLES[band] || SYLLABLES.northern;
  const slice = (list, n) => {
    const pool = [...list];
    const out = [];
    for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    return out;
  };
  return {
    heads: slice(src.heads, Math.min(5, src.heads.length)),
    mids: slice(src.mids, Math.min(4, src.mids.length)),
    coastal: slice(src.coastal, Math.min(4, src.coastal.length)),
    interior: slice(src.interior, Math.min(4, src.interior.length))
  };
}

/* Pre-verified inventions, used only when a region's table has been exhausted
   without producing anything the filter will accept. They go through the same
   filter as everything else — a reserve list that skipped the check would be the
   one place a real name could get in. */
const RESERVE = [
  'Velmoras', 'Ostrenka', 'Kaldrivo', 'Thernuval', 'Zamburel', 'Prakovin',
  'Elsombra', 'Yavrenth', 'Corvalain', 'Umbrisel', 'Dravonek', 'Salterin',
  'Novaskir', 'Ferrandal', 'Tashiveq', 'Lorenwald', 'Miravost', 'Kesseran',
  'Anturek', 'Volsedra', 'Bramekil', 'Ondrisai', 'Requandi', 'Yllovar'
];

const ATTEMPTS = 160;   // per nation, and then the reserve, and then a shrug

/* Deterministic from the seed and the place, filtered, and unique against both
   the other new nations and the powers that already exist — `powers.name` is
   UNIQUE, so a collision would fail the commit rather than the preview. */
function nameFor({ seed, index, lat, lon, coastal, taken }) {
  const band = bandOf(lat);
  const sector = Math.max(0, Math.min(5, Math.floor((lon + 180) / 60)));
  const t = regionTable(seed, band, sector);
  const r = rng(`${seed}|name|${index}`);
  const pick = list => list[Math.floor(r() * list.length)] || '';

  const tries = [];
  for (let i = 0; i < ATTEMPTS; i++) {
    const head = pick(t.heads);
    const tail = pick(coastal ? t.coastal : t.interior);
    if (!head || !tail) break;
    const mid = r() < 0.55 ? pick(t.mids) : '';
    const candidate = head + mid + tail;
    tries.push(candidate);
    if (taken.has(normalise(candidate))) continue;
    if (looksReal(candidate)) continue;
    return { name: candidate, band, sector, degraded: false, attempts: i + 1 };
  }
  for (const candidate of RESERVE) {
    if (taken.has(normalise(candidate))) continue;
    if (looksReal(candidate)) continue;
    return { name: candidate, band, sector, degraded: true, attempts: ATTEMPTS };
  }
  /* Everything has been refused, which means either the filter or the tables are
     broken. Answer with something that cannot collide and SAY that naming
     degraded, rather than crashing an admin route or — far worse — quietly
     relaxing the filter. */
  let n = 0, fallback;
  do { fallback = `Unnamed Power ${++n}`; } while (taken.has(normalise(fallback)) && n < 200);
  return { name: fallback, band, sector, degraded: true, attempts: ATTEMPTS, unnamed: true };
}

/* "Skarvik" -> "Skarvikian", "Vera" -> "Veran". Crude, but a power needs an
   adjective for the dispatch templates and inventing a second table for it would
   be inventing a second way to leak. */
function adjectiveFor(name) {
  const base = String(name).replace(/\s+/g, '');
  return (/[aeiouy]$/i.test(base) ? base + 'n' : base + 'ian').slice(0, 60);
}

/* ------------------------------------------------------------- the heap */

/* A binary min-heap by cost. Small enough that an array-and-sort would do, but
   the growth loop pops tens of thousands of times and a sort per pop is the one
   place this could become slow enough to time out an admin request. */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(x) {
    const a = this.a;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].cost <= a[i].cost) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  peek() { return this.a[0]; }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].cost < a[m].cost) m = l;
        if (r < a.length && a[r].cost < a[m].cost) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/* ------------------------------------------------------------ the spread

   One clearly stronger, two above, two level, two below, one that could be
   pushed around. The Republic is mid-table, has somebody it can plausibly beat
   and somebody it cannot, and both of those facts are legible from the map. For
   any other count the same ladder is resampled, so the extremes survive. */
const SPREAD = [2.0, 1.3, 1.3, 1.0, 1.0, 0.7, 0.7, 0.4];

function spreadFor(n) {
  if (n <= 1) return [1.0];
  const out = [];
  for (let i = 0; i < n; i++) out.push(SPREAD[Math.round((i * (SPREAD.length - 1)) / (n - 1))]);
  return out;
}

const hsl = (h, s, l) => {
  const k = m => (m + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = m => Math.round(255 * (l - a * Math.max(-1, Math.min(k(m) - 3, Math.min(9 - k(m), 1)))));
  return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
};

const RECOGNITION =
  'Every power here arrives unrecognised, and that is correct rather than broken. ' +
  'Recognition is a bill: until the House passes one, a power draws with a dashed border on the map ' +
  'and can neither enter a treaty nor trade. The first decision the House gets to make about this ' +
  'world is which parts of it exist as far as the Republic is concerned.';

/* ================================================================ mount */

module.exports.mount = function mount(app, ctx) {
  const { q, tx, log, admin, wrap, loadConfig, bcrypt, crypto } = ctx;

  const NOMINAL_STRENGTH = 40;    // stands in when the Republic has no standing forces at all
  const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
  const dec = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  const needAtlas = res => {
    if (atlas.graph()) return true;
    res.status(503).json({ error: 'The world atlas is not in this build, so there is no ground to hand out.' });
    return false;
  };

  /* Every module here is optional and a missing one has to be a sentence, not a
     stack trace. Without diplomacy there is nowhere to put a foreign power at
     all; the tables would not even exist. */
  const needDiplomacy = res => {
    if (ctx.diplomacy) return true;
    res.status(503).json({ error: 'Diplomacy is not running, so there is nothing for a generated world to be made of.' });
    return false;
  };

  /* The Republic's own number, and it has to be the SAME number the front line
     uses or "stronger than us" means one thing on the map and another in a
     conflict. war.js owns it. Where war.js is not in the build the Returning
     Officer has to supply the figure explicitly rather than have one invented
     under them. */
  async function republicStrength(override) {
    if (override !== undefined && override !== null && override !== '') {
      const n = Math.max(1, int(override, 0));
      if (n > 0) return { value: n, source: 'given by the Returning Officer' };
    }
    if (!ctx.war) return null;
    const ours = await ctx.war.effectiveStrength();
    if (ours > 0) return { value: ours, source: 'war.js, the same figure the front line uses' };
    return {
      value: NOMINAL_STRENGTH,
      source: `the Republic has no supplied formations, so a nominal ${NOMINAL_STRENGTH} was used`,
      nominal: true
    };
  }

  /* Ground nobody holds. A whole-territory row in either legacy table takes all
     of that territory's subdivisions out of play — the row means the whole
     country, and handing out a province inside it would put two flags on one
     piece of ground. */
  async function unclaimed() {
    const g = atlas.graph();
    const pool = new Set(g.cells.keys());
    const drop = id => pool.delete(id);

    for (const r of (await q('SELECT subdivision_code FROM republic_subdivisions')).rows) drop(r.subdivision_code);
    for (const r of (await q('SELECT subdivision_code FROM foreign_subdivisions')).rows) drop(r.subdivision_code);
    for (const r of (await q('SELECT code FROM republic_territories')).rows) atlas.subdivisionsOf(r.code).forEach(drop);
    for (const r of (await q('SELECT code FROM territories')).rows) atlas.subdivisionsOf(r.code).forEach(drop);
    return pool;
  }

  /* ------------------------------------------------------------ growth */

  function seedCapitals(pool, n, seed, reachBase) {
    const g = atlas.graph();
    const list = [...pool].sort();                     // sorted, so the seed alone decides
    const r = rng(`${seed}|capitals`);
    const chosen = [];

    /* A capital wants somewhere it can grow from. A piece with no land border is
       an island, and an island capital spends its whole budget on sea crossings. */
    const rooted = list.filter(id => [...(g.adjacency.get(id) || new Map()).values()].some(w => w > 0));
    const from = rooted.length >= n ? rooted : list;

    chosen.push(from[Math.floor(r() * from.length)]);
    const SAMPLES = 32;
    while (chosen.length < n) {
      let best = null;
      for (let s = 0; s < SAMPLES; s++) {
        const id = from[Math.floor(r() * from.length)];
        if (chosen.includes(id)) continue;
        const c = g.cells.get(id);
        let near = Infinity;
        for (const other of chosen) {
          const o = g.cells.get(other);
          near = Math.min(near, Math.hypot(c.cx - o.cx, c.cy - o.cy));
        }
        if (!best || near > best.near) best = { id, near };
      }
      /* The sample can miss entirely on a tiny pool. Falling back to the first
         thing not already taken keeps this bounded — the alternative is a
         while-loop that spins when n is close to the pool size. */
      if (!best) best = { id: from.find(id => !chosen.includes(id)) };
      if (!best.id) break;
      chosen.push(best.id);
    }

    /* How much output sits within an ordinary nation's reach of each capital,
       before anything is handed out. The strongest power is then seated in the
       roomiest place, which is the cheapest thing that can be done to stop a 2.0x
       neighbour being generated onto an island. */
    return chosen.map(id => {
      const c = g.cells.get(id);
      let room = 0;
      for (const other of pool) {
        const o = g.cells.get(other);
        if (Math.hypot(o.cx - c.cx, o.cy - c.cy) <= reachBase) room += o.output;
      }
      return { capital: id, room, cx: c.cx, cy: c.cy };
    });
  }

  /* Each nation takes the cheapest piece available next to what it already
     holds. Cost rises with distance from its capital, falls along a shared
     coastline, and triples across open water — which is what makes the long
     coastal states and the round interior ones without anybody drawing them.

     A piece is costed once per nation, when it first becomes reachable, rather
     than re-costed every time another edge reaches it. Cost is dominated by
     distance from the capital, which does not change, so the difference is not
     worth a second heap. */
  function grow(nations, pool, seed) {
    const g = atlas.graph();
    const cells = g.cells;

    const costOf = (nation, fromId, toId, weight) => {
      const cap = cells.get(nation.capital);
      const from = cells.get(fromId);
      const to = cells.get(toId);
      const dist = Math.hypot(to.cx - cap.cx, to.cy - cap.cy);
      const coastal = Math.min(from.coast, to.coast);
      let cost = dist * (1 - 0.45 * coastal);
      if (weight === 0) cost *= 3.0;                       // across water
      else cost *= 1 + 0.6 / (1 + weight);                 // a long shared border is cheaper than a corner
      cost *= 0.85 + 0.3 * jitter(seed, `${nation.index}:${toId}`);
      return { cost, dist };
    };

    const claim = (nation, id) => {
      pool.delete(id);
      nation.cells.push(id);
      nation.output += cells.get(id).output;
      for (const [nb, weight] of atlas.graph().adjacency.get(id) || []) {
        if (!pool.has(nb) || nation.seen.has(nb)) continue;
        nation.seen.add(nb);
        const { cost, dist } = costOf(nation, id, nb, weight);
        nation.heap.push({ id: nb, cost, dist });
      }
    };

    /* The capital is claimed before anything grows, so no seed can produce a
       nation with no territory. */
    for (const n of nations) claim(n, n.capital);

    /* Every pass either pops one heap entry or retires one nation, and the total
       number of entries any nation can push is bounded by the pool it started
       with. The counter is belt to that braces: an admin route must not be able
       to spin. */
    let guard = (pool.size + nations.length) * (nations.length + 2) + 2000;
    while (guard-- > 0) {
      let pick = null;
      for (const n of nations) {
        if (n.done) continue;
        if (n.output >= n.budget) { n.done = true; n.stopped = n.stopped || 'budget met'; continue; }
        while (n.heap.size && !pool.has(n.heap.peek().id)) n.heap.pop();
        if (!n.heap.size) { n.done = true; n.stopped = 'nothing left within reach'; continue; }
        const ratio = n.output / n.budget;
        if (!pick || ratio < pick.ratio) pick = { n, ratio };
      }
      if (!pick) break;

      const n = pick.n;
      const next = n.heap.pop();
      if (!pool.has(next.id)) continue;

      /* Reach stops a nation stringing a tendril across a continent to make up a
         budget. Hitting it is a real outcome and is reported as a shortfall
         rather than papered over — an unsatisfiable budget the RO can see is
         worth more than a satisfied one that looks absurd. */
      if (next.dist > n.reach) { n.done = true; n.stopped = 'reached its limit'; continue; }

      /* One enormous province can carry a small nation far past its budget. It is
         passed over and left for somebody else; after enough of those there is
         evidently nothing small enough left. */
      if (n.output + cells.get(next.id).output > n.budget * 1.6) {
        if (++n.passed > 50) { n.done = true; n.stopped = 'nothing left small enough for its budget'; }
        continue;
      }
      claim(n, next.id);
    }
    for (const n of nations) if (!n.done) n.stopped = 'stopped at the iteration guard';
  }

  /* ---------------------------------------------------------- generate */

  async function generate(opts, actorId) {
    const g = atlas.graph();
    const seed = String(opts.seed || '').trim().slice(0, 64) ||
      crypto.randomBytes(6).toString('hex');
    const count = clamp(int(opts.powers, 8), 1, 24);
    const fillShare = clamp(dec(opts.fill_share, 0.72), 0.2, 0.95);
    const reachBase = clamp(dec(opts.reach, 170), 40, 400);

    const base = await republicStrength(opts.republic_strength);
    if (!base) {
      return {
        error: 'war.js is not in this build, so the Republic has no strength to measure a world against. ' +
          'Send republic_strength to say what it should be measured against instead.',
        status: 503
      };
    }

    const pool = await unclaimed();
    if (pool.size < count) {
      return {
        error: `There are ${pool.size} unclaimed pieces of ground and ${count} powers were asked for. ` +
          'Ask for fewer powers, or release some territory first.',
        status: 409
      };
    }

    const multiples = Array.isArray(opts.spread) && opts.spread.length === count
      ? opts.spread.map(v => clamp(dec(v, 1), 0.05, 20))
      : spreadFor(count);

    const seats = seedCapitals(pool, count, seed, reachBase);
    if (seats.length < count) {
      return { error: 'The unclaimed world is too broken up to seat that many capitals.', status: 409 };
    }

    /* The exchange rate between land and strength, derived from the land that is
       actually there. Budgets then add up to `fillShare` of what the capitals can
       reach, so they are satisfiable by construction and the remaining share is
       the world's genuine unclaimed gaps rather than an oversight. */
    const roomTotal = seats.reduce((n, s) => n + s.room, 0);
    if (!(roomTotal > 0)) {
      return { error: 'The unclaimed ground has no measurable extent, so no world can be sized against it.', status: 409 };
    }
    const totalStrength = multiples.reduce((n, m) => n + m, 0) * base.value;
    const scale = totalStrength / (roomTotal * fillShare);
    if (!Number.isFinite(scale) || scale <= 0) {
      return { error: 'The strength budget could not be reconciled with the land available.', status: 409 };
    }

    /* Strongest into the roomiest seat. Power was decided before the map; this is
       only about not seating it somewhere it cannot possibly be realised. */
    const order = [...seats].sort((a, b) => b.room - a.room);
    const budgets = [...multiples].sort((a, b) => b - a);
    const meanBudget = budgets.reduce((n, m) => n + m, 0) / budgets.length;

    const nations = order.map((seat, i) => ({
      index: i,
      capital: seat.capital,
      multiple: budgets[i],
      budget: (budgets[i] * base.value) / scale,
      reach: reachBase * Math.sqrt(Math.max(0.15, budgets[i] / meanBudget)),
      cells: [],
      seen: new Set([seat.capital]),
      heap: new Heap(),
      output: 0,
      passed: 0,
      done: false,
      stopped: null
    }));

    grow(nations, pool, seed);

    const existing = new Set(
      (await q('SELECT name FROM powers')).rows.map(r => normalise(r.name))
    );
    const usedNames = new Set(existing);

    const hueBase = Math.floor(jitter(seed, 'hue') * 360);
    const out = nations.map((n, i) => {
      let cx = 0, cy = 0, area = 0;
      let coastal = 0;
      for (const id of n.cells) {
        const c = g.cells.get(id);
        const w = Math.max(c.area, 0.01);
        cx += c.cx * w; cy += c.cy * w; area += w;
        coastal += c.coast * w;
      }
      cx /= area; cy /= area; coastal /= area;

      const named = nameFor({
        seed,
        index: n.index,
        lat: atlas.latOf(cy),
        lon: atlas.lonOf(cx),
        coastal: coastal > 0.28,
        taken: usedNames
      });
      usedNames.add(normalise(named.name));

      const strength = Math.max(1, Math.round(n.output * scale));
      return {
        name: named.name,
        adjective: adjectiveFor(named.name),
        colour: hsl((hueBase + Math.round((360 * i) / nations.length)) % 360, 0.5, 0.42),
        capital: n.capital,
        subdivisions: n.cells.slice().sort(),
        subdivision_count: n.cells.length,
        output: Math.round(n.output * 100) / 100,
        strength,
        target_multiple: Math.round(n.multiple * 100) / 100,
        achieved_multiple: Math.round((strength / base.value) * 100) / 100,
        satisfied: n.output >= n.budget * 0.98,
        stopped_because: n.stopped || 'budget met',
        region: `${named.band}/${named.sector}`,
        name_degraded: !!named.degraded,
        /* The one number a later recompute must not re-derive. Freezing it here is
           what stops the world rubber-banding when the Republic re-arms. */
        strength_per_output: scale
      };
    });

    const claimedNow = out.reduce((n, p) => n + p.subdivision_count, 0);
    const warnings = [];
    for (const p of out) {
      if (!p.satisfied) {
        warnings.push(`${p.name} wanted ${p.target_multiple}x the Republic and reached ${p.achieved_multiple}x — ${p.stopped_because}.`);
      }
    }
    if (out.some(p => p.name_degraded)) {
      warnings.push('At least one name came from the reserve list because the region table could not produce one the real-place filter would accept.');
    }
    if (base.nominal) warnings.push(base.source + '.');

    return {
      seed,
      params: { powers: count, fill_share: fillShare, reach: reachBase, spread: multiples },
      republic_strength: base.value,
      republic_strength_source: base.source,
      strength_per_output: scale,
      unclaimed_before: pool.size + claimedNow,
      unclaimed_after: pool.size,
      claimed_by_generation: claimedNow,
      nations: out,
      warnings,
      recognition: RECOGNITION,
      actor: actorId || null
    };
  }

  /* ------------------------------------------------------------ routes */

  /* Generate a PREVIEW and store it. Nothing exists in the world until it is
     committed, so the RO can throw a dozen of these away. */
  app.post('/api/world/generate', admin, wrap(async (req, res) => {
    if (!needAtlas(res) || !needDiplomacy(res)) return;
    await loadConfig();
    let plan;
    try {
      plan = await generate(req.body || {}, req.user.id);
    } catch (err) {
      if (err.code === '42P01')
        return res.status(503).json({ error: 'The diplomacy tables are not in this database, so there is nothing to generate into.' });
      throw err;
    }
    if (plan.error) return res.status(plan.status || 400).json({ error: plan.error });

    const row = (await q(
      `INSERT INTO world_generations(seed,status,params,plan,republic_strength,strength_per_output,created_by)
       VALUES($1,'preview',$2,$3,$4,$5,$6) RETURNING id, seed, status, created_at`,
      [plan.seed, plan.params, plan, plan.republic_strength, plan.strength_per_output, req.user.id]
    )).rows[0];
    log(req.user.id, 'world.generate', `seed ${plan.seed}: ${plan.nations.length} powers, ${plan.claimed_by_generation} subdivisions`);
    res.json({
      ...row,
      ...plan,
      preview_svg: `/api/world/generations/${row.id}/preview.svg`,
      next: 'Look at the preview. Nothing exists in the world until you commit it.'
    });
  }));

  app.get('/api/world/generations', admin, wrap(async (_req, res) => {
    const { rows } = await q(`
      SELECT g.id, g.seed, g.status, g.republic_strength, g.created_at, g.committed_at,
             u.display_name AS created_by_name,
             jsonb_array_length(COALESCE(g.plan->'nations','[]'::jsonb)) AS powers
        FROM world_generations g LEFT JOIN users u ON u.id=g.created_by
       ORDER BY g.id DESC LIMIT 40`);
    res.json({ generations: rows, recognition: RECOGNITION });
  }));

  app.get('/api/world/generations/:id', admin, wrap(async (req, res) => {
    const row = (await q('SELECT * FROM world_generations WHERE id=$1::bigint', [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'No such generation.' });
    res.json({ ...row.plan, id: row.id, status: row.status, committed_at: row.committed_at, recognition: RECOGNITION });
  }));

  /* No world goes live unseen. This is the seeing. */
  app.get('/api/world/generations/:id/preview.svg', admin, wrap(async (req, res) => {
    if (!needAtlas(res)) return;
    const row = (await q('SELECT * FROM world_generations WHERE id=$1::bigint', [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'No such generation.' });
    const a = atlas.atlas();
    const e = s => String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const base = Object.values(a.shapes).join('');
    const held = (await q('SELECT subdivision_code FROM republic_subdivisions')).rows
      .map(r => atlas.coarseShape(r.subdivision_code)).filter(Boolean)
      .concat((await q('SELECT code FROM republic_territories')).rows
        .map(r => atlas.territoryShape(r.code)).filter(Boolean));

    const g = atlas.graph();
    /* Invented names only. There is no id, no code and no real name anywhere in
       what follows — a preview gets screenshotted like everything else. A label
       starts at the area-weighted centroid of every subdivision its nation owns,
       so it is centred on the generated nation as a whole rather than its capital.
       A small deterministic nudge is used only if two nation-centre labels collide. */
    const nations = row.plan?.nations || [];
    const labelBoxes = [];
    const labelPositions = new Map();
    const overlaps = (a, b, pad = 2) =>
      a.x < b.x + b.w + pad && a.x + a.w + pad > b.x &&
      a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
    const offsets = [
      [0, 0], [0, -10], [0, 10], [14, 0], [-14, 0],
      [14, -10], [-14, -10], [14, 10], [-14, 10]
    ];
    const nationCentre = n => {
      let area = 0, cx = 0, cy = 0;
      for (const id of n.subdivisions || []) {
        const c = g.cells.get(id);
        if (!c || !(c.area > 0)) continue;
        area += c.area;
        cx += c.cx * c.area;
        cy += c.cy * c.area;
      }
      if (area > 0) return { x: cx / area, y: cy / area, area };
      const capital = g.cells.get(n.capital);
      return capital ? { x: capital.cx, y: capital.cy, area: 0 } : null;
    };
    const centred = nations
      .map(n => ({ n, centre: nationCentre(n) }))
      .filter(x => x.centre)
      .sort((a, b) => b.centre.area - a.centre.area);
    for (const { n, centre } of centred) {
      const w = Math.max(18, String(n.name || '').length * 4.1);
      const h = 8;
      let best = null;
      for (const [dx, dy] of offsets) {
        const x = Math.max(w / 2 + 2, Math.min(a.width - w / 2 - 2, centre.x + dx));
        const y = Math.max(h / 2 + 2, Math.min(a.height - h / 2 - 2, centre.y + dy));
        const box = { x: x - w / 2, y: y - h / 2, w, h };
        const collisions = labelBoxes.reduce((count, other) => count + (overlaps(box, other) ? 1 : 0), 0);
        if (!best || collisions < best.collisions) best = { x, y, box, collisions };
        if (!collisions) break;
      }
      if (!best) continue;
      labelBoxes.push(best.box);
      labelPositions.set(n, best);
    }

    let body = '';
    for (const n of nations) {
      const d = (n.subdivisions || []).map(atlas.coarseShape).filter(Boolean).join('');
      if (!d) continue;
      body += `\n  <path d="${d}" fill="${e(n.colour)}" fill-rule="nonzero" stroke="#FFFFFF" stroke-width="0.3" stroke-dasharray="2 1.4" opacity="0.92"/>`;
    }
    for (const n of nations) {
      const pos = labelPositions.get(n);
      if (!pos) continue;
      body += `\n  <text x="${Math.round(pos.x)}" y="${Math.round(pos.y)}" font-family="'Times New Roman', Times, serif" font-size="7" text-anchor="middle" dominant-baseline="middle" fill="#111111" paint-order="stroke" stroke="#F7F8F9" stroke-width="1.8" stroke-linejoin="round">${e(n.name)}</text>`;
    }

    res.set('Content-Type', 'image/svg+xml; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${a.width} ${a.height}" width="${a.width * 2}" height="${a.height * 2}" role="img" aria-label="Preview of a generated world">
  <title>Preview of a generated world</title>
  <rect x="0" y="0" width="${a.width}" height="${a.height}" fill="#EDEFF2"/>
  <path d="${base}" fill="#D5D9DE" fill-rule="nonzero"/>
  <path d="${held.join('')}" fill="#1E2A5A" fill-rule="nonzero"/>${body}
</svg>
`);
  }));

  app.post('/api/world/generations/:id/discard', admin, wrap(async (req, res) => {
    const row = (await q("UPDATE world_generations SET status='discarded' WHERE id=$1::bigint AND status='preview' RETURNING id",
      [req.params.id])).rows[0];
    if (!row) return res.status(409).json({ error: 'That generation is not an uncommitted preview.' });
    log(req.user.id, 'world.discard', `generation ${row.id}`);
    res.json({ ok: true, id: row.id });
  }));

  /* Commit. The plan is checked against the world as it is NOW, not as it was
     when the preview was taken — a generation sitting in a tab for a week must
     not be able to hand out ground the Returning Officer has since assigned. */
  app.post('/api/world/generations/:id/commit', admin, wrap(async (req, res) => {
    if (!needAtlas(res) || !needDiplomacy(res)) return;
    const row = (await q('SELECT * FROM world_generations WHERE id=$1::bigint', [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'No such generation.' });
    if (row.status !== 'preview') return res.status(409).json({ error: `That generation is already ${row.status}.` });

    const plan = row.plan || {};
    const nations = Array.isArray(plan.nations) ? plan.nations : [];
    if (!nations.length) return res.status(409).json({ error: 'That generation contains no powers.' });

    const wanted = nations.flatMap(n => n.subdivisions || []);
    const free = await unclaimed();
    const conflicts = wanted.filter(id => !free.has(id));
    if (conflicts.length)
      return res.status(409).json({
        error: `${conflicts.length} of the ${wanted.length} pieces in this generation are no longer unclaimed. ` +
          'Generate again — committing part of a world would leave a map nobody planned.',
        conflicts: conflicts.length
      });

    const clash = (await q('SELECT name FROM powers WHERE lower(name) = ANY($1)',
      [nations.map(n => String(n.name).toLowerCase())])).rows;
    if (clash.length)
      return res.status(409).json({
        error: `A power already exists called: ${clash.map(c => c.name).join(', ')}. Generate again with a different seed.`
      });

    /* Keys are shown once, here, exactly as /api/admin/foreign/powers does it.
       A generated power is a real power: it can be handed to a cabinet later. */
    const created = [];
    await tx(async run => {
      for (const n of nations) {
        const secret = crypto.randomBytes(24).toString('base64url');
        const hash = await bcrypt.hash(secret, 10);
        const p = (await run(
          `INSERT INTO powers(name,adjective,key_hash,colour,standing,persona,strength)
           VALUES($1,$2,$3,$4,'neutral',$5,$6) RETURNING id,name,adjective,colour,standing,recognised,strength`,
          [String(n.name).slice(0, 120), String(n.adjective || '').slice(0, 80), hash,
           String(n.colour || '#5B2E9E').slice(0, 20),
           { generated: true, seed: plan.seed, region: n.region || '' },
           Math.max(1, parseInt(n.strength, 10) || 1)]
        )).rows[0];

        for (const id of n.subdivisions || []) {
          const country = atlas.territoryOf(id);
          if (!country) continue;
          await run(
            `INSERT INTO foreign_subdivisions(subdivision_code,country_code,power_id,assigned_by)
             VALUES($1,$2,$3,$4) ON CONFLICT (subdivision_code) DO NOTHING`,
            [id, country, p.id, req.user.id]
          );
        }
        await run(
          `INSERT INTO world_powers(power_id,generation_id,target_multiple,output,strength_per_output,capital)
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT (power_id) DO UPDATE SET generation_id=EXCLUDED.generation_id,
             target_multiple=EXCLUDED.target_multiple, output=EXCLUDED.output,
             strength_per_output=EXCLUDED.strength_per_output, capital=EXCLUDED.capital`,
          [p.id, row.id, n.target_multiple || 1, n.output || 0,
           n.strength_per_output || plan.strength_per_output || 0, n.capital || null]
        );
        created.push({ ...p, key: `fp_${p.id}_${secret}`, subdivisions: (n.subdivisions || []).length });
      }
      await run("UPDATE world_generations SET status='committed', committed_at=now() WHERE id=$1::bigint", [row.id]);
    });

    log(req.user.id, 'world.commit',
      `generation ${row.id}, seed ${plan.seed}: ${created.length} powers, ${wanted.length} subdivisions`);
    res.json({
      ok: true,
      id: row.id,
      powers: created,
      recognition: RECOGNITION,
      keys: 'Each key is shown once. It is only needed if a power is later given an LLM cabinet of its own.'
    });
  }));

  /* Re-derive strength from the ground each power currently holds.

     The rate is the one frozen when the power was generated, and it is not
     recomputed here on purpose. Re-deriving it from the Republic's current
     strength would mean a neighbour got stronger because we did, which is a
     rubber band, and players spot a rubber band within one cycle. What this route
     is for is the other direction: territory changed hands, so strength should
     have changed with it. */
  app.post('/api/world/strength/recompute', admin, wrap(async (req, res) => {
    if (!needAtlas(res) || !needDiplomacy(res)) return;
    const g = atlas.graph();
    const rows = (await q(`
      SELECT w.power_id, w.strength_per_output, p.name, p.strength
        FROM world_powers w JOIN powers p ON p.id=w.power_id
       WHERE p.revoked_at IS NULL AND w.strength_per_output > 0
       ORDER BY w.power_id`)).rows;

    const out = [];
    for (const r of rows) {
      const held = (await q('SELECT subdivision_code FROM foreign_subdivisions WHERE power_id=$1', [r.power_id])).rows
        .map(x => x.subdivision_code);
      for (const t of (await q('SELECT code FROM territories WHERE power_id=$1', [r.power_id])).rows) {
        held.push(...atlas.subdivisionsOf(t.code));
      }
      let output = 0;
      for (const id of new Set(held)) output += g.cells.get(id)?.output || 0;
      const next = Math.max(1, Math.round(output * Number(r.strength_per_output)));
      if (next !== Number(r.strength)) {
        await q('UPDATE powers SET strength=$1 WHERE id=$2', [next, r.power_id]);
      }
      await q('UPDATE world_powers SET output=$1 WHERE power_id=$2', [output, r.power_id]);
      out.push({ power_id: r.power_id, name: r.name, was: Number(r.strength), now: next, subdivisions: new Set(held).size });
    }
    const moved = out.filter(o => o.was !== o.now);
    if (moved.length) log(req.user.id, 'world.strength.recompute', `${moved.length} of ${out.length} powers moved`);
    res.json({
      powers: out,
      moved: moved.length,
      note: 'Strength was re-derived from the land each power now holds, at the rate frozen when it was generated. ' +
        'The Republic\'s own strength was not used, and generated powers never scale with it after the fact.'
    });
  }));

  ctx.worldgen = { generate, unclaimed, spreadFor, looksReal, nameFor };
};
