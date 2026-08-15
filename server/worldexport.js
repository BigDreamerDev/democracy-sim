/* The Republic's own shape, as a file you can put in the group chat.

   A small feature with one hard rule attached to it. The map is opaque on
   purpose: real coastlines, invented countries, and no player ever sees a real
   place name. An image leaves the app and gets forwarded, and an export carrying
   `id="AE-AJ"` or a comment naming a real country would leak the conceit
   permanently, into a place nobody can recall it from. So nothing here writes an
   identifier of any kind into the output: no `id`, no `class`, no `data-`, no
   `<desc>`, no XML comment, no `<metadata>`. What comes out is geometry, the
   Flag Act's colours, and the Republic's own name. `test/export.mjs` reads the
   bytes back and asserts it.

   For the same reason this module never loads the real-name table at all. It
   cannot leak what it has not got.

   It renders on the server for the same reason the world is generated on the
   server: an export everyone can produce identically is evidence, and one
   assembled in the browser out of data the browser was handed is a screenshot
   with extra steps.

   Deliberately no PNG. Rasterising needs a binary on Render and the browser
   already has one — a Download PNG button draws this SVG onto a canvas at
   whatever size the sharer wants. */

'use strict';

const atlas = require('./worldatlas');

module.exports.mount = function mount(app, ctx) {
  const { q, wrap, loadConfig } = ctx;

  const e = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hex = v => (/^#?[0-9a-f]{6}$/i.test(String(v || '')) ? '#' + String(v).replace('#', '').toUpperCase() : null);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const r1 = n => Math.round(n * 10) / 10;

  /* The palette is the Flag Act's, like everything else that shows the
     Republic's face. server.js parses the same schedule for the site and does
     not export the function, so the six lines that matter are repeated here
     rather than reaching into it: the schedule format is the contract, not the
     parser. */
  async function palette() {
    await loadConfig();
    const ref = ctx.CONFIG.flag_law_ref;
    const law = ref
      ? (await q('SELECT body FROM laws WHERE ref=$1 AND repealed_at IS NULL', [ref])).rows[0]
      : null;
    const bands = [];
    let device = null;
    for (const raw of String(law?.body || '').split('\n')) {
      const m = raw.trim().match(/^(band|device)\s*=\s*(.+)$/i);
      if (!m) continue;
      const colour = hex((m[2].match(/#[0-9a-f]{6}/i) || [])[0]);
      if (!colour) continue;
      if (m[1].toLowerCase() === 'band') bands.push(colour);
      else device = colour;
    }
    const inked = bands.filter(c => c !== '#FFFFFF');
    const land = inked[0] || '#1E2A5A';
    return {
      land,
      /* The outline is the flag's second colour where there is one, so a
         two-tone flag produces a two-tone map. */
      outline: inked[1] || device || land,
      paper: bands.includes('#FFFFFF') ? '#FFFFFF' : '#F6F6F4',
      ink: inked[inked.length - 1] || land,
      device: device || land
    };
  }

  /* What the Republic actually holds, as path strings and nothing else.

     A territory every subdivision of which is held is drawn as the whole
     territory: one fewer seam in the outline, and also true. Anything held in
     part is drawn piece by piece. Where a piece has no geometry in this build it
     is counted and skipped rather than drawn whole — drawing it whole would
     claim ground on the image that the Republic does not hold. */
  async function pieces() {
    const whole = (await q('SELECT code FROM republic_territories ORDER BY code')).rows.map(r => r.code);
    const subs = (await q(`SELECT country_code, subdivision_code
                             FROM republic_subdivisions
                            ORDER BY country_code, subdivision_code`)).rows;

    const byCountry = new Map();
    for (const row of subs) {
      if (!byCountry.has(row.country_code)) byCountry.set(row.country_code, []);
      byCountry.get(row.country_code).push(row.subdivision_code);
    }

    const fill = [];        // what the union is drawn from
    const inner = [];       // the same pieces again, for ?borders=1
    let missing = 0;
    const countries = new Set(whole);

    for (const code of whole) {
      const d = atlas.territoryShape(code);
      if (d) { fill.push(d); inner.push(d); } else missing++;
    }

    for (const [country, held] of byCountry) {
      countries.add(country);
      const total = atlas.subdivisionCount(country);
      const wholeShape = atlas.territoryShape(country);
      if (total && held.length >= total && wholeShape) {
        fill.push(wholeShape);
        /* The internal lines are still the pieces, or ?borders=1 on a wholly
           held territory would draw nothing. */
        for (const code of held) {
          const sd = atlas.detailShape(code);
          if (sd) inner.push(sd);
        }
        continue;
      }
      for (const code of held) {
        const sd = atlas.detailShape(code);
        if (sd) { fill.push(sd); inner.push(sd); } else missing++;
      }
    }

    return { fill, inner, missing, countries: countries.size, subdivisions: subs.length };
  }

  /* GET /api/world/export.svg

     Public, because the map is public and a nation's outline is the least secret
     thing about it. */
  app.get('/api/world/export.svg', wrap(async (req, res) => {
    if (!atlas.atlas())
      return res.status(503).json({ error: 'The world atlas is not in this build, so there is nothing to draw from.' });

    let held;
    try {
      held = await pieces();
    } catch (err) {
      /* No diplomacy schema means no territory tables at all. That is a build
         without a map, not a broken request. */
      if (err.code === '42P01')
        return res.status(503).json({ error: 'Diplomacy is not running, so the Republic holds no map to export.' });
      throw err;
    }

    if (!held.fill.length)
      return res.status(404).json({
        error: 'The Republic holds no territory yet, so there is nothing to draw.',
        skipped_for_missing_geometry: held.missing
      });

    const pal = await palette();
    const borders = String(req.query.borders || '') === '1';
    const labels = String(req.query.labels ?? '1') !== '0';
    const scale = clamp(Number(req.query.scale) || 1, 0.25, 6);
    const world = String(req.query.frame || 'nation') === 'world';
    const bgParam = String(req.query.bg || '');
    const bg = bgParam === 'transparent' ? null : (hex(bgParam) || pal.paper);

    const a = atlas.atlas();
    let vx = 0, vy = 0, vw = a.width, vh = a.height;
    if (!world) {
      const box = atlas.bboxOf(held.fill);
      if (box) {
        const pad = Math.max(6, (box.maxX - box.minX + box.maxY - box.minY) * 0.05);
        vx = r1(Math.max(0, box.minX - pad));
        vy = r1(Math.max(0, box.minY - pad));
        vw = r1(Math.min(a.width - vx, box.maxX - box.minX + pad * 2));
        vh = r1(Math.min(a.height - vy, box.maxY - box.minY + pad * 2));
      }
    }
    /* A single-island republic crops to a couple of pixels, which no viewer
       renders usefully. */
    vw = Math.max(vw, 12); vh = Math.max(vh, 12);
    if (labels) vh = r1(vh + Math.max(14, vh * 0.16));   // room under the shape for the name

    const w = Math.round(vw * scale * 2);   // 2x, so the default export is not a postage stamp
    const h = Math.round(vh * scale * 2);
    const d = held.fill.join('');
    const stroke = Math.max(0.35, vh / 260);

    const nameSize = Math.max(5, vh * 0.055);
    const subSize = nameSize * 0.6;
    const nation = e(ctx.CONFIG.nation_name || 'The Republic');
    let text = '';
    if (labels) {
      const line = `${held.countries} ${held.countries === 1 ? 'territory' : 'territories'}` +
        (held.subdivisions ? ` · ${held.subdivisions} ${held.subdivisions === 1 ? 'district' : 'districts'}` : '');
      const x = r1(vx + vw * 0.02);
      const y = r1(vy + vh - nameSize * 1.2);
      text = `
  <text x="${x}" y="${y}" font-family="Georgia, 'Times New Roman', serif" font-size="${r1(nameSize)}" font-weight="600" fill="${pal.ink}">${nation}</text>
  <text x="${x}" y="${r1(y + subSize * 1.5)}" font-family="Georgia, 'Times New Roman', serif" font-size="${r1(subSize)}" fill="${pal.ink}" opacity="0.7">${e(line)} · as at ${new Date().toISOString().slice(0, 10)}</text>`;
    }

    /* The union, without a geometry library.

       The whole shape is drawn twice: once as a wide stroke with no fill, then
       filled on top. Every internal seam's halo is covered by the fill on both
       sides of it, so what survives is the outer edge — one outline around the
       union, which is what was asked for. `paint-order` does the same in one
       element and is not honoured by every renderer that opens an SVG out of a
       chat app. */
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${w}" height="${h}" role="img" aria-label="${nation}">
  <title>${nation}</title>
${bg ? `  <rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="${bg}"/>\n` : ''}  <path d="${d}" fill="none" stroke="${pal.outline}" stroke-width="${r1(stroke * 2.4)}" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="${d}" fill="${pal.land}" fill-rule="nonzero"/>${borders ? `
  <path d="${held.inner.join('')}" fill="none" stroke="${pal.paper === '#FFFFFF' ? '#FFFFFF' : pal.outline}" stroke-width="${r1(stroke * 0.7)}" stroke-linejoin="round" opacity="0.55"/>` : ''}${text}
</svg>
`;

    res.set('Content-Type', 'image/svg+xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=60');
    if (String(req.query.download || '') === '1') {
      const file = String(ctx.CONFIG.nation_name || 'republic')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'republic';
      res.set('Content-Disposition', `attachment; filename="${file}.svg"`);
    }
    res.send(svg);
  }));

  /* What the export can be asked for, so a front end need not hardcode it, and
     what it would draw right now. Cheap enough to call before showing a button
     that would 404. */
  app.get('/api/world/export', wrap(async (_req, res) => {
    if (!atlas.atlas()) return res.status(503).json({ error: 'The world atlas is not in this build.' });
    let held = { fill: [], inner: [], missing: 0, countries: 0, subdivisions: 0 };
    try { held = await pieces(); } catch (err) { if (err.code !== '42P01') throw err; }
    res.json({
      url: '/api/world/export.svg',
      available: held.fill.length > 0,
      territories: held.countries,
      subdivisions: held.subdivisions,
      skipped_for_missing_geometry: held.missing,
      parameters: {
        borders: '1 draws the internal district lines',
        labels: '0 removes the name and the date',
        scale: '0.25 to 6, multiplies the pixel size',
        bg: 'transparent, or a #RRGGBB',
        frame: 'nation (cropped, the default) or world',
        download: '1 sends it as an attachment'
      },
      png: 'Draw this SVG onto a canvas in the browser. The server has no rasteriser and should not get one.'
    });
  }));

  ctx.worldexport = { palette, pieces };
};
