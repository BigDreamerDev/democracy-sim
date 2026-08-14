/* The Fed page must never offer anyone a way to dismiss the Fed.

   The server refuses it, but a button that appears and then 403s teaches
   players that the office is removable and they simply lack the knack. The
   independence of the Fed has to be visible, not just enforced.

   Needs the dev dependency: npm install jsdom */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'money.js'), 'utf8');
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) fails++; };

const CITIZENS = [
  { id: 1, display_name: 'Ada', offices: [] },
  { id: 2, display_name: 'Bea', offices: ['president'] },
  { id: 3, display_name: 'Cyd', offices: ['fed_chair'] }
];

const FED = chairSeated => ({
  chair: chairSeated ? { id: 3, display_name: 'Cyd' } : null,
  term_ends: chairSeated ? new Date(Date.now() + 6e8).toISOString() : null,
  nomination: null,
  house: 5, needed: 3, i_confirmed: false,
  i_am_chair: false,
  issued: 4000, circulating: 12000, terms: 3,
  rates: { deposit_rate: 0.02, loan_rate: 0.05, loan_ceiling: 500, reserve_ratio: 0.2 },
  decisions: [{ ref: 'F001', kind: 'rate', detail: 'loan_rate 0.05 → 0.08', reasons: 'Credit is tightening.', by_name: 'Cyd', at: new Date().toISOString() }]
});

const TREASURY = treasurerSeated => ({
  treasurer: treasurerSeated ? { id: 1, display_name: 'Ada' } : null,
  appointer: 'president',
  balance: -2400, escrow: 0, fed_balance: -4000, circulating: 12000,
  flows: [], statements: [],
  currency: { name: 'Mark', symbol: 'M' },
  ownership_cap: 0.4,
  i_am_treasurer: false
});

/* Runs one of the page functions against a stub Republic and returns the DOM. */
async function render(view, { offices = [], fed = FED(true), treasury = TREASURY(true), banks } = {}) {
  const dom = new JSDOM('<div id="view"></div><div id="toast"></div>');
  const { window } = dom;
  const doc = window.document;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const routes = {};
  const Republic = {
    api: async p => {
      if (p === '/api/citizens') return CITIZENS;
      if (p === '/api/fed') return fed;
      if (p === '/api/treasury') return treasury;
      if (p === '/api/banks') return banks || { banks: [], charter_fee: 250, reserve_ratio: 0.2, guarantee: 300, i_am_chair: false };
      throw new Error('404 no such endpoint');
    },
    esc,
    md: s => `<p>${esc(s)}</p>`,
    toast: () => {},
    $: s => doc.querySelector(s),
    when: () => 'just now',
    day: () => 'a day',
    state: () => ({ config: { nation_name: 'R', currency_symbol: 'M', motto: 'm' } }),
    me: () => ({ id: 9, display_name: 'Someone', offices }),
    reload: () => {},
    addRoute: (p, _l, fn) => { routes[p] = fn; },
    addSubRoute: () => {},
    refreshNav: () => {}
  };

  window.Republic = Republic;
  const fn = new window.Function('window', 'document', src + '\nreturn window.__views;');
  // The module registers its views through addRoute; capture them and run one.
  window.__views = routes;
  fn(window, doc);
  // addRoute is called from an async IIFE, so let it settle.
  await new Promise(r => setTimeout(r, 20));
  const target = routes[view];
  if (!target) return { text: '', html: '', missing: true };
  const v = doc.querySelector('#view');
  await target(v);
  return { text: v.textContent, html: v.innerHTML, doc };
}

(async () => {
  console.log('-- the Fed, seen by the President who appointed its head');
  let r = await render('fed', { offices: ['president'] });
  ok(!r.missing, 'the page registers');
  ok(!/data-resign/.test(r.html), 'no way to remove the head of the Fed');
  ok(!/id="rates"/.test(r.html), 'no way to set the rate of interest');
  ok(!/id="issue"/.test(r.html) && !/id="retire"/.test(r.html), 'no way to touch the money supply');
  ok(/Cyd/.test(r.text), 'but the chair and their term are on the page');
  ok(/cannot be changed by a bill|21\.10/.test(r.text), 'and it says plainly why the rates are out of reach');

  console.log('\n-- the Fed, seen by the House');
  r = await render('fed', { offices: ['mp', 'speaker'] });
  ok(!/data-resign/.test(r.html), 'the Speaker cannot remove them either');
  ok(!/id="rates"/.test(r.html), 'nor set the rates');

  console.log('\n-- the Fed, seen by its own head');
  r = await render('fed', { offices: ['fed_chair'], fed: { ...FED(true), i_am_chair: true } });
  ok(/id="rates"/.test(r.html), 'the chair sets the rates');
  ok(/id="issue"/.test(r.html), 'and issues');
  ok(/data-resign/.test(r.html), 'and may lay the office down themselves');
  ok(/textarea name="reasons"/.test(r.html), 'every decision form demands published reasons');

  console.log('\n-- nominating');
  r = await render('fed', { offices: ['president'], fed: FED(false) });
  ok(/id="nominate"/.test(r.html), 'a President may nominate to a vacant Fed');
  r = await render('fed', { offices: ['president'], fed: FED(true) });
  ok(!/id="nominate"/.test(r.html), 'and may not while it is filled');

  console.log('\n-- the Treasury');
  r = await render('treasury', { offices: ['president'] });
  ok(!r.missing, 'the page registers');
  ok(/id="appoint"/.test(r.html), 'the appointer can appoint');
  ok(!/id="currency"/.test(r.html), 'but cannot name the money');
  r = await render('treasury', { offices: [], treasury: { ...TREASURY(true), i_am_treasurer: true } });
  ok(/id="currency"/.test(r.html) && /id="cap"/.test(r.html), 'the Treasurer names the money and fixes the cap');
  ok(/id="statement"/.test(r.html), 'and reports to the House');
  ok(!/id="appoint"/.test(r.html), 'and cannot appoint their own successor');
  ok(/deficit/.test(r.text), 'a Treasury in deficit says so rather than hiding it');

  console.log(fails ? `\n${fails} FAILURES` : '\nevery office sees its own powers and no one else’s');
  process.exit(fails ? 1 : 0);
})();
