/* The desk must show each officer what only they can do — and nothing else.

   The complaint that produced it: the President's screen was identical to
   everyone else's. These assertions are what stop that regressing.
   Needs the dev dependency: npm install jsdom */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'app.js'), 'utf8');
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) fails++; };

/* A Republic with one bill at every stage, so every office has work. */
const BILLS = [
  { id: 1, ref: 'B001', title: 'Passed Act', status: 'passed', seconds: 2 },
  { id: 2, ref: 'B002', title: 'Tabled Act', status: 'tabled', seconds: 2 },
  { id: 3, ref: 'B003', title: 'Divided Act', status: 'division', seconds: 2 },
  { id: 4, ref: 'B004', title: 'Seconded Act', status: 'draft', seconds: 2 }
];

async function deskFor(offices, isAdmin = false) {
  const dom = new JSDOM('<div id="view"><div id="desk"></div></div><div id="toast"></div>');
  const { window } = dom;
  const doc = window.document;

  const STATE = {
    config: { seconds_required: '2', nation_name: 'R', motto: 'm' },
    elections: [{ id: 9, title: 'A poll', status: 'voting' }],
    stats: { petitions: 1 }
  };
  const ME = { id: 1, display_name: 'X', is_admin: isAdmin, offices };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const has = o => !!ME.offices.includes(o) || ME.is_admin;
  const $ = s => doc.querySelector(s);
  const api = async p => {
    if (p === '/api/bills') return BILLS;
    if (/^\/api\/bills\/\d+$/.test(p)) {
      return { my_vote: null, can_vote: has('mp'), counts: { aye: 1, no: 0, eligible: 5 }, division: [{}] };
    }
    if (/^\/api\/elections\/\d+$/.test(p)) return { can_vote: true, my_vote: null, turnout: 2, eligible: 8 };
    return {};
  };
  const toast = () => {}, refreshState = async () => {};
  const onAction = () => {};

  const body = src.slice(src.indexOf('async function deskItems'), src.indexOf('async function viewChamber'));
  const fn = new window.Function(
    'STATE', 'ME', 'esc', 'has', '$', 'api', 'toast', 'refreshState', 'onAction', 'document', 'window',
    body + '\nreturn drawDesk;'
  );
  await fn(STATE, ME, esc, has, $, api, toast, refreshState, onAction, doc, window)();
  return doc.querySelector('#desk').textContent;
}

(async () => {
  console.log('-- the President');
  let t = await deskFor(['president']);
  ok(/B001/.test(t), 'sees the bill awaiting assent');
  ok(/Assent/.test(t) && /Veto/.test(t), 'with assent and veto on the front page');
  ok(!/Call the division|Table it/.test(t), 'and none of the Speaker\u2019s business');
  ok(!/B004/.test(t), 'nor a bill that has not reached them yet');

  console.log('\n-- the Speaker');
  t = await deskFor(['mp', 'speaker']);
  ok(/B004/.test(t) && /Table it/.test(t), 'sees a bill with its seconders, and can table it');
  ok(/B002/.test(t) && /Call the division/.test(t), 'sees a tabled bill, and can call the division');
  ok(/Close the division/.test(t), 'and can close an open one — nothing closes itself');
  ok(!/Assent/.test(t), 'but cannot assent');

  console.log('\n-- an ordinary MP');
  t = await deskFor(['mp']);
  ok(/B003/.test(t) && /Aye/.test(t) && /Abstain/.test(t), 'can vote in the open division from here');
  ok(!/Table it|Assent/.test(t), 'and holds no other office\u2019s powers');

  console.log('\n-- a citizen with no office');
  t = await deskFor([]);
  ok(/A poll/.test(t) && /Go and vote/.test(t), 'is told about the poll they have not voted in');
  ok(/signature/i.test(t), 'and about initiatives needing names');
  ok(!/Assent|Table it|Aye/.test(t), 'and is offered no power they do not have');

  console.log('\n-- nothing to do');
  const quiet = await (async () => {
    const saved = BILLS.splice(0, BILLS.length);
    const out = await deskFor([]);
    BILLS.push(...saved);
    return out;
  })();
  ok(/waiting on you/i.test(quiet), 'says so plainly rather than showing an empty box');

  console.log(fails ? `\n${fails} FAILURES` : '\nevery office sees its own work and no one else\u2019s');
  process.exit(fails ? 1 : 0);
})();
