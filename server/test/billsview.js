/* Render the Bills page as each kind of user and check the forms wire up. */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const path = require('path');
const base = path.join(__dirname, '..', '..', 'docs') + '/';
const src = fs.readFileSync(base + 'app.js', 'utf8');

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) fails++; };

// Pull viewBills out and run it against a stub DOM + stub api().
async function render({ isMP, mode }) {
  const dom = new JSDOM('<div id="view"></div><div id="toast"></div>');
  const { window } = dom;
  global.window = window; global.document = window.document;

  const STATE = { config: {
    initiative_mode: mode, petition_share: '0.334', initiative_threshold: '0.7',
    seconds_required: '2', impeachment_threshold: '0.667', allow_veto_override: 'false'
  } };
  const ME = { id: 1, is_admin: false, offices: isMP ? ['mp'] : [] };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const canPropose = () => STATE.config.bill_proposers === 'citizens' || ME.is_admin
    || !!ME.offices.some(o => o === 'mp' || o === 'speaker');
  const api = async (p) => p === '/api/laws' ? [{ id: 9, ref: 'L009', title: 'A Law' }]
    : p === '/api/citizens' ? [{ id: 2, display_name: 'Someone', offices: ['president'] }] : [];
  const $ = s => window.document.querySelector(s);
  const statusTag = () => '', toast = () => {}, route = () => {}, md = x => x, when = () => '', day = () => '';

  const RULE_KEYS = ['seats', 'quorum', 'cycle_days'];
  const body = src.slice(src.indexOf('async function viewBills'), src.indexOf('async function viewBill(v, id)'));
  const fn = new Function('STATE','ME','esc','canPropose','api','$','statusTag','toast','route','md','when','day','RULE_KEYS','window','document',
    'return (' + body.replace(/^async function viewBills/, 'async function') + ')');
  const viewBills = fn(STATE, ME, esc, canPropose, api, $, statusTag, toast, route, md, when, day, RULE_KEYS, window, window.document);
  await viewBills($('#view'));
  await new Promise(r => setTimeout(r, 20));
  return window.document;
}

(async () => {
  for (const mode of ['table', 'enact', 'off']) {
    for (const isMP of [true, false]) {
      const who = isMP ? 'MP  ' : 'non-MP';
      let d;
      try { d = await render({ isMP, mode }); }
      catch (e) { ok(false, `${who} / ${mode}: threw — ${e.message}`); continue; }
      const mk = d.querySelector('#mk'), init = d.querySelector('#init');
      ok(!!mk === isMP, `${who} / ${mode}: bill form ${isMP ? 'shown' : 'hidden'}`);
      ok(!!init === (mode !== 'off'), `${who} / ${mode}: initiative form ${mode !== 'off' ? 'shown' : 'hidden'}`);
      if (init) {
        ok(!!d.querySelector('#initlaw'), `${who} / ${mode}: initiative can name a law`);
        ok(d.querySelector('#initlaw').options.length > 1, `${who} / ${mode}: law list populated`);
        ok(d.querySelector('#initlawwrap').hidden, `${who} / ${mode}: law picker hidden until amend/repeal`);
      }
      if (mk) ok(d.querySelector('#targ').options.length > 1, `${who} / ${mode}: bill form law list populated`);
      if (!isMP && mode === 'off') ok(d.body.textContent.includes('switched off'), `${who} / ${mode}: told why they cannot propose`);
    }
  }
  console.log(fails ? `\n${fails} FAILURES` : '\nboth forms behave for every user and every mode');
  process.exit(fails ? 1 : 0);
})();
