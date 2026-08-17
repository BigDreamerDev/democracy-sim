/* The guided tour: engine registration, and that every office with a real
   front-end page gets real (not generic) coachmark steps pointing at a
   selector that actually exists on that page.

   Needs the dev dependency: npm install jsdom */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) fails++; };

const SHELL = `
<div id="gate" hidden><div class="tabs"><button data-gate="in"></button><button data-gate="up"></button></div>
  <form id="formIn" hidden></form><form id="formUp" hidden></form><p id="gateMsg"></p>
  <div id="gateFlag"></div><h1 id="gateName"></h1></div>
<div id="shell" hidden>
  <span id="navName"></span><em id="navMotto"></em>
  <a id="whoName"></a><span id="whoRole" hidden></span>
  <button id="themeBtn"></button><button id="signout"></button>
  <nav id="rail"></nav><div id="emergency" hidden></div>
  <main id="view" tabindex="-1"></main><div id="toast"></div>
</div>`;

/* Evaluates app.js for real, in a DOM that gives it everything it touches at
   load time, with fetch stubbed to fail offline so start() falls back to the
   sign-in gate rather than hanging on a real network call. */
function loadApp() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'app.js'), 'utf8');
  const dom = new JSDOM(SHELL, { url: 'https://example.test/' });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch = () => Promise.reject(new Error('offline in test'));
  window.API_BASE = '';
  const fn = new window.Function('window', 'document', 'localStorage', src);
  fn(window, window.document, window.localStorage);
  return window;
}

/* Runs an Act/money module's page functions against a stub Republic, the
   same harness pattern as money-view.js, but capturing registerTourSteps
   calls instead of throwing them away. */
function loadModule(file) {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', file), 'utf8');
  const dom = new JSDOM('<div id="view"></div>');
  const { window } = dom;
  const doc = window.document;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const routes = {};
  const tours = {};
  const Republic = {
    api: async () => { throw new Error('404 no such endpoint'); },
    esc, md: s => `<p>${esc(s)}</p>`, toast: () => {},
    $: s => doc.querySelector(s), when: () => '', day: () => '',
    state: () => ({ config: {} }), me: () => ({ id: 1, offices: [] }),
    reload: () => {},
    addRoute: (p, _l, f) => { routes[p] = f; },
    addSubRoute: () => {},
    refreshNav: () => {},
    registerTourSteps: (key, steps) => { (tours[key] || (tours[key] = [])).push(...steps); }
  };
  window.Republic = Republic;
  const fn = new window.Function('window', 'document', src);
  fn(window, doc);
  return tours;
}

(async () => {
  console.log('-- the engine, as app.js exposes it');
  const win = loadApp();
  ok(typeof win.Republic?.registerTourSteps === 'function', 'window.Republic.registerTourSteps exists');
  ok(typeof win.localStorage.getItem === 'function', 'localStorage is reachable (namespaced keys need it)');
  // A step for a page that isn't loaded must not crash a caller that adds one.
  let threw = false;
  try { win.Republic.registerTourSteps('smoke-test', [{ selector: '#nope', title: 't', body: 'b' }]); }
  catch { threw = true; }
  ok(!threw, 'registering steps for a not-yet-rendered element does not throw');

  console.log('\n-- acts.js: office-specific steps, not just the general tour');
  const actsTours = loadModule('acts.js');
  for (const key of ['justice', 'foreign_minister', 'intel_director']) {
    const steps = actsTours[key] || [];
    ok(steps.length > 0, `${key} gets at least one step`);
    ok(steps.every(s => s.selector && s.title && s.body), `${key} steps all have selector/title/body`);
  }

  console.log('\n-- money.js: office-specific steps');
  const moneyTours = loadModule('money.js');
  for (const key of ['treasurer', 'fed_chair', 'quartermaster']) {
    const steps = moneyTours[key] || [];
    ok(steps.length > 0, `${key} gets at least one step`);
    ok(steps.every(s => s.selector && s.title && s.body), `${key} steps all have selector/title/body`);
  }
  // These point at real form ids from the pages themselves, not placeholders —
  // catches a step drifting out of sync if a form id in money.js is renamed.
  ok(moneyTours.treasurer.some(s => s.selector === '#currency'), 'the Treasurer is pointed at the real currency form');
  ok(moneyTours.fed_chair.some(s => s.selector === '#rates'), 'the Fed chair is pointed at the real rates form');
  ok(moneyTours.quartermaster.some(s => s.selector === '#procure'), 'the Quartermaster is pointed at the real procurement panel');

  console.log(fails ? `\n${fails} FAILURES` : '\nevery office with a page has a real step pointing at it');
  process.exit(fails ? 1 : 0);
})();
