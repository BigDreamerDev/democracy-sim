/* The world as geometry the server can reason about.

   Everything the front end draws is precomputed into `docs/` at build time, and
   that is also the only place the shapes exist. So the server reads those same
   files rather than keeping a second copy that would quietly drift from the one
   players are looking at. They are parsed once and cached: nothing in `docs/`
   changes while the process is up.

   Three files matter.

     docs/world-map.js        whole-territory outlines, keyed by UN M49
     docs/subdiv/parents.json every subdivision id -> its territory
     docs/subdiv/<M49>.json   that territory's subdivisions, simplified
     docs/subdiv/<M49>.d.json the same, at full detail

   Everything works in the projected 1000x500 space those files declare. Nothing
   here hands a real place name to a caller. `realNames()` exists for exactly one
   purpose — to REJECT a generated name that resembles a real one — and it is the
   only door to that table. Anything that renders, exports or serialises goes
   through the opaque codes instead: M49 for a territory, `s0001` for a
   subdivision. Subdivision ids are looked up here and never constructed by
   pattern, because the generator that assigns them is free to change shape.

   Two derived things the rest of the build needs and cannot get anywhere else.

   **Adjacency.** There is no adjacency table anywhere in the repo, so it is
   computed from the geometry: boundary vertices are hashed into a one-pixel grid
   and two subdivisions that occupy a cell together share a border. The count of
   shared cells is a serviceable proxy for how long that border is. Coastline
   falls out of the same pass for free — a boundary cell nobody else is in is a
   cell facing the sea.

   That last inference is honest but not exact. The two files are simplified
   independently, so an international border whose vertices no longer coincide
   reads as a little coastline on both sides. A one-pixel cell (about 40km at the
   equator) absorbs most of it, and the number is only ever used as a weight, not
   as a fact.

   **Notional output.** Projected area, weighted by latitude band and by how much
   coast a piece has. It is the number a generated nation's strength is summed
   from, so that taking land actually means something. */

'use strict';

const fs = require('fs');
const path = require('path');

/* Render checks the whole repository out and only changes directory into
   `server`, so `../docs` is there. A few other places are tried anyway: a
   missing atlas has to become a clean 503 from a route, never a crash at
   require time. */
const CANDIDATES = [
  path.join(__dirname, '..', 'docs'),
  path.join(__dirname, 'docs'),
  path.join(process.cwd(), 'docs'),
  path.join(process.cwd(), '..', 'docs')
];

function docsFile(...parts) {
  for (const dir of CANDIDATES) {
    const p = path.join(dir, ...parts);
    try { if (fs.statSync(p).isFile()) return p; } catch { /* try the next root */ }
  }
  return null;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/* `world-map.js` is a `window.X = {...};` assignment, not JSON, so the object is
   found by matching braces from the assignment. A regex across a file of path
   data is a good way to lose an afternoon. */
function readAssignment(file, varName) {
  const text = fs.readFileSync(file, 'utf8');
  const at = text.indexOf(`window.${varName}`);
  if (at < 0) return null;
  const start = text.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  return null;
}

let ATLAS;          // { width, height, shapes } keyed by M49
let PARENTS;        // subdivision id -> M49
let BY_TERRITORY;   // M49 -> [subdivision id]
let COARSE;         // subdivision id -> path, every territory, ~320KB in total
let NAMES;          // real place names, for the filter and nothing else
let GRAPH;          // adjacency + per-subdivision statistics
const DETAIL = new Map();   // M49 -> { id: path }, loaded only when asked

function atlas() {
  if (ATLAS !== undefined) return ATLAS;
  ATLAS = null;
  const file = docsFile('world-map.js');
  if (file) {
    try {
      const parsed = readAssignment(file, 'WORLD_MAP');
      if (parsed && parsed.shapes) ATLAS = parsed;
    } catch (err) {
      console.error('[republic] the world atlas could not be read:', err.message);
    }
  }
  return ATLAS;
}

/* The parent table is the authority on which subdivision belongs to which
   territory and, by counting, on how many a territory has. Nothing here parses
   an id: the format is the subdivision generator's business, not ours. */
function parents() {
  if (PARENTS !== undefined) return PARENTS;
  PARENTS = null;
  BY_TERRITORY = null;
  const file = docsFile('subdiv', 'parents.json');
  const parsed = file ? readJson(file) : null;
  if (parsed && typeof parsed === 'object') {
    PARENTS = parsed;
    BY_TERRITORY = {};
    for (const [id, country] of Object.entries(parsed)) {
      (BY_TERRITORY[country] || (BY_TERRITORY[country] = [])).push(id);
    }
    for (const list of Object.values(BY_TERRITORY)) list.sort();
  }
  return PARENTS;
}

const territoryOf = id => parents()?.[String(id)] || null;
const subdivisionsOf = code => (parents(), BY_TERRITORY?.[String(code)] || []);
const subdivisionCount = code => subdivisionsOf(code).length;

/* The simplified set, all of it. 320KB across 338 files is cheap enough to hold
   for the life of the process and it is what every measurement below is taken
   from, so measurements stay consistent between two callers. */
function coarse() {
  if (COARSE !== undefined) return COARSE;
  COARSE = null;
  if (!parents()) return COARSE;
  const out = new Map();
  for (const code of Object.keys(BY_TERRITORY)) {
    const file = docsFile('subdiv', `${code}.json`);
    if (!file) continue;
    const parsed = readJson(file);
    for (const [id, d] of Object.entries(parsed?.shapes || {})) out.set(id, d);
  }
  COARSE = out.size ? out : null;
  return COARSE;
}

/* Full detail, one territory at a time. Three megabytes in total, and only ever
   wanted for an export of the handful of territories somebody actually holds. */
function detailOf(code) {
  const key = String(code);
  if (DETAIL.has(key)) return DETAIL.get(key);
  const file = docsFile('subdiv', `${key}.d.json`) || docsFile('subdiv', `${key}.json`);
  const shapes = file ? (readJson(file)?.shapes || null) : null;
  DETAIL.set(key, shapes);
  return shapes;
}

const territoryShape = code => atlas()?.shapes?.[String(code)] || null;
const coarseShape = id => coarse()?.get(String(id)) || null;
const detailShape = id => {
  const country = territoryOf(id);
  return (country && detailOf(country)?.[String(id)]) || coarseShape(id);
};

/* Every real name the build knows about, for the name filter to refuse. The
   territory names come out of the atlas; the subdivision names come out of
   `server/subdivisions.json`, which the Returning Officer's console already
   reads. NOTHING else may call this — a caller that renders what it returns has
   leaked the whole conceit. */
function realNames() {
  if (NAMES !== undefined) return NAMES;
  const out = new Set();
  const file = docsFile('world-map.js');
  if (file) {
    try {
      const parsed = readAssignment(file, 'TERRITORY_NAMES');
      for (const v of Object.values(parsed || {})) if (v) out.add(String(v));
    } catch { /* the filter still has the subdivision list below */ }
  }
  try {
    const subs = require('./subdivisions.json');
    for (const list of Object.values(subs)) {
      for (const s of list) if (s && s.name) out.add(String(s.name));
    }
  } catch { /* likewise */ }
  NAMES = [...out];
  return NAMES;
}

/* ------------------------------------------------------------- geometry */

/* The generated paths use absolute M, L and Z and nothing else, one subpath per
   island. Parsed into plain rings of points. */
function rings(d) {
  const out = [];
  for (const part of String(d || '').split('M').slice(1)) {
    const pts = [];
    for (const chunk of part.replace(/Z/gi, '').split('L')) {
      if (!chunk) continue;
      const comma = chunk.indexOf(',');
      if (comma < 0) continue;
      const px = Number(chunk.slice(0, comma)), py = Number(chunk.slice(comma + 1));
      if (Number.isFinite(px) && Number.isFinite(py)) pts.push([px, py]);
    }
    if (pts.length >= 3) out.push(pts);
  }
  return out;
}

/* Fitted against nine territories whose real centroids are known — Norway to
   Argentina, Kenya through India — and good to about a degree in the middle
   latitudes, which is all a latitude BAND needs. It exists so that a northern
   state gets a northern-sounding name. It is not a reprojection and must not be
   used as one. */
const latOf = y => 85.6 - 0.3 * y;
const lonOf = x => -182.7 + 0.366 * x;

/* Which land is more productive per square pixel is a judgement, not a fact:
   temperate land carries the most, the poles the least, and the tropics sit
   between. It lives here rather than in the generator because output has to mean
   the same thing everywhere it is summed. */
function bandFactor(lat) {
  const a = Math.abs(lat);
  if (a > 66) return 0.35;
  if (a > 55) return 0.75;
  if (a > 23) return 1.15;
  return 0.9;
}

const CELL = 1;   // projected pixels; about 40km at the equator

/* Each vertex is dropped into the four cells around it, so two vertices within a
   pixel of each other always land in a cell together — and coincident vertices,
   which is what a shared border actually is in this topology, always do. */
function cellsOf(points) {
  const set = new Set();
  for (const [x, y] of points) {
    for (const dx of [-0.5, 0.5]) {
      for (const dy of [-0.5, 0.5]) {
        set.add(`${Math.floor((x + dx) / CELL)}:${Math.floor((y + dy) / CELL)}`);
      }
    }
  }
  return set;
}

function measure(d) {
  const rs = rings(d);
  if (!rs.length) return null;
  let area = 0, cx = 0, cy = 0;
  const points = [];
  for (const ring of rs) {
    let signed = 0, rx = 0, ry = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
      const f = x1 * y2 - x2 * y1;
      signed += f;
      rx += (x1 + x2) * f;
      ry += (y1 + y2) * f;
    }
    signed /= 2;
    const w = Math.abs(signed);
    if (w > 1e-9) {
      area += w;
      cx += (rx / (6 * signed)) * w;
      cy += (ry / (6 * signed)) * w;
    }
    for (const p of ring) points.push(p);
  }
  if (area <= 0) {
    /* A shape too small to have an area still has a position, and it is still a
       piece of ground somebody could be given. */
    if (!points.length) return null;
    const mx = points.reduce((n, p) => n + p[0], 0) / points.length;
    const my = points.reduce((n, p) => n + p[1], 0) / points.length;
    return { area: 0, cx: mx, cy: my, points };
  }
  return { area, cx: cx / area, cy: cy / area, points };
}

/* One pass over every subdivision in the build, cached for the life of the
   process. Per piece: its territory, area, centroid, latitude, longitude, how
   much of its boundary faces the sea, and its notional output. Plus the
   adjacency graph the generator grows along. */
function graph() {
  if (GRAPH !== undefined) return GRAPH;
  GRAPH = null;
  const shapes = coarse();
  if (!shapes) return GRAPH;

  const cells = new Map();       // subdivision id -> stat
  const occupants = new Map();   // grid cell -> Set(id)

  for (const [id, d] of shapes) {
    const m = measure(d);
    if (!m) continue;
    const grid = cellsOf(m.points);
    for (const cell of grid) {
      let set = occupants.get(cell);
      if (!set) occupants.set(cell, (set = new Set()));
      set.add(id);
    }
    cells.set(id, {
      code: id,
      country: territoryOf(id),
      area: m.area,
      cx: m.cx,
      cy: m.cy,
      lat: latOf(m.cy),
      lon: lonOf(m.cx),
      border: grid.size,
      coast: 0,
      output: 0
    });
  }

  const adjacency = new Map([...cells.keys()].map(id => [id, new Map()]));
  const shared = new Map();
  for (const set of occupants.values()) {
    if (set.size < 2) continue;
    const ids = [...set];
    for (const id of ids) shared.set(id, (shared.get(id) || 0) + 1);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = adjacency.get(ids[i]), b = adjacency.get(ids[j]);
        a.set(ids[j], (a.get(ids[j]) || 0) + 1);
        b.set(ids[i], (b.get(ids[i]) || 0) + 1);
      }
    }
  }
  occupants.clear();

  for (const s of cells.values()) {
    s.coast = Math.max(0, Math.min(1, 1 - (shared.get(s.code) || 0) / Math.max(1, s.border)));
    s.output = Math.max(0.25, s.area * bandFactor(s.lat) * (1 + 0.25 * s.coast));
  }

  /* An island touches nobody, and a nation seeded on one would have nowhere to
     grow and no way for anyone to reach it. Anything with no land border is
     therefore given the two nearest pieces across water, marked with weight 0 so
     the generator can charge more for the crossing. Nothing reaches further than
     `SEA_REACH` — an ocean is supposed to stop a border. */
  const SEA_REACH = 60;
  const all = [...cells.values()];
  for (const s of all) {
    const near = adjacency.get(s.code);
    if (near.size >= 1) continue;
    const by = all
      .filter(o => o.code !== s.code)
      .map(o => ({ o, d: Math.hypot(o.cx - s.cx, o.cy - s.cy) }))
      .sort((p, r) => p.d - r.d)
      .slice(0, 2);
    for (const { o, d } of by) {
      if (d > SEA_REACH) break;
      near.set(o.code, 0);
      adjacency.get(o.code).set(s.code, 0);
    }
  }

  GRAPH = { cells, adjacency, width: atlas()?.width || 1000, height: atlas()?.height || 500 };
  return GRAPH;
}

/* The extent of a set of path strings, for cropping an export to the shape it is
   actually of. */
function bboxOf(paths) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of paths) {
    for (const ring of rings(d)) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

module.exports = {
  atlas, graph, realNames, rings, bboxOf, measure,
  territoryShape, territoryOf, subdivisionsOf, subdivisionCount,
  coarseShape, detailShape,
  latOf, lonOf, bandFactor
};
