/* The world map must be readable without reading.

   Two claims to hold: standing is the fill and recognition is the border, and
   real country names never reach a player. That last one is not cosmetic — the
   whole conceit is invented countries on real coastlines, and one leaked
   "United States of America" on the map collapses it.

   Needs the dev dependency: npm install jsdom */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..', '..');
const mapData = fs.readFileSync(path.join(root, 'docs', 'world-map.js'), 'utf8');
const src = fs.readFileSync(path.join(root, 'docs', 'acts.js'), 'utf8');

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) fails++; };

const WORLD = {
  claimed: 3,
  enabled: true,
  powers: [
    { id: 1, name: 'Valtia', adjective: 'Valtish', colour: '#5B2E9E', standing: 'allied', recognised: true, territories: ['124', '840'] },
    { id: 2, name: 'Korrin', adjective: 'Korrine', colour: '#B4543F', standing: 'at_war', recognised: false, territories: ['076'] }
  ]
};

async function render(world, { admin = false } = {}) {
  const dom = new JSDOM('<div id="view"></div>');
  const { window } = dom;
  const doc = window.document;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const routes = {};
  window.Republic = {
    api: async p => {
      // world === null stands for an older server that has no map endpoint yet.
      if (p === '/api/diplomacy/map') {
        if (!world) throw new Error('404 no such endpoint');
        return world;
      }
      if (p === '/api/diplomacy/powers') return world ? world.powers : [];
      if (p.startsWith('/api/admin/foreign/powers')) return admin && world ? world.powers : [];
      return [];
    },
    esc,
    md: s => `<p>${esc(s)}</p>`,
    toast: () => {},
    $: s => doc.querySelector(s),
    when: () => 'now',
    day: () => 'a day',
    state: () => ({ config: { nation_name: 'R', currency_symbol: 'M', justice_terms: '2' } }),
    me: () => ({ id: 9, display_name: 'Someone', offices: [], is_admin: admin }),
    reload: () => {},
    addRoute: (p, _l, fn) => { routes[p] = fn; },
    addSubRoute: () => {},
    refreshNav: () => {}
  };

  /* jsdom without runScripts shares Node's realm, so `window` is not a global
     inside an evaluated script. Pass it in explicitly, as the other view checks
     do — world-map.js sets its data on window and acts.js reads it back off. */
  new window.Function('window', 'document', mapData)(window, doc);
  new window.Function('window', 'document', src)(window, doc);
  await new Promise(r => setTimeout(r, 20));
  return { routes, doc, window };
}

(async () => {
  const { routes, doc } = await render(WORLD);
  const view = routes.diplomacy;
  ok(!!view, 'the diplomacy view registers');
  await view();
  const html = doc.querySelector('#view').innerHTML;

  console.log('\n-- the map draws');
  ok(/wm-svg/.test(html), 'an SVG world is rendered');
  const claims = doc.querySelectorAll('.wm-claim').length;
  const land = doc.querySelectorAll('.wm-land').length;
  ok(claims === 3, `three claimed territories are drawn as claims (${claims})`);
  ok(land > 100, `and the rest of the world is drawn as unclaimed land (${land})`);

  console.log('\n-- standing is the fill');
  const valtia = [...doc.querySelectorAll('.wm-claim')].filter(n => n.dataset.power === '1');
  const korrin = [...doc.querySelectorAll('.wm-claim')].filter(n => n.dataset.power === '2');
  ok(valtia.length === 2 && korrin.length === 1, 'each power holds the ground it claims');
  ok(valtia[0].getAttribute('style') !== korrin[0].getAttribute('style'),
    'an ally and a state at war are not the same colour');
  ok(korrin[0].classList.contains('is-at-war'), 'a state at war is marked as such');

  console.log('\n-- recognition is the border');
  ok(valtia[0].classList.contains('is-recognised'), 'a recognised power is drawn solid');
  ok(korrin[0].classList.contains('is-unrecognised'), 'an unrecognised one is drawn dashed');
  ok(/not recognised/.test(html), 'and the legend says what the dashes mean');

  console.log('\n-- no real country names reach a player');
  for (const leak of ['United States', 'Canada', 'France', 'Brazil', 'Nigeria', 'India']) {
    ok(!html.includes(leak), `"${leak}" appears nowhere on the page`);
  }
  ok(/Valtia/.test(html) && /Korrin/.test(html), 'the invented names do appear');
  ok(doc.querySelectorAll('.wm-label').length === 2, 'one label per power, not one per territory');

  console.log('\n-- an empty world');
  const empty = await render({ powers: [], claimed: 0, enabled: true });
  await empty.routes.diplomacy();
  const emptyHtml = empty.doc.querySelector('#view').innerHTML;
  ok(/wm-svg/.test(emptyHtml), 'the map still draws with no powers at all');
  ok(/No foreign powers exist yet/.test(emptyHtml), 'and says so plainly rather than showing a blank frame');

  console.log('\n-- the map survives a server without it');
  const none = await render(null);
  await none.routes.diplomacy();
  ok(!/wm-svg/.test(none.doc.querySelector('#view').innerHTML),
    'an older server with no /api/diplomacy/map renders the page without a map, not an error');

  console.log(fails ? `\n${fails} FAILURES` : '\nthe world reads at a glance, and keeps its own names');
  process.exit(fails ? 1 : 0);
})();
