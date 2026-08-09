/* Layout check: the sign-in gate and the app shell must never both render.
   Needs the dev dependency: npm install jsdom */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const path = require('path');
const base = path.join(__dirname, '..', '..', 'docs') + '/';
const html = fs.readFileSync(base + 'index.html', 'utf8')
  .replace(/<link[^>]*fonts[^>]*>/g, '')
  .replace('<link rel="stylesheet" href="styles.css">',
           '<style>' + fs.readFileSync(base + 'styles.css', 'utf8') + '</style>');
const { window } = new JSDOM(html);
const doc = window.document;
const disp = id => { const e = doc.getElementById(id); return e ? window.getComputedStyle(e).display : 'MISSING'; };
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) fails++; };

console.log('-- landing on the sign-in screen');
ok(disp('gate') !== 'none', 'the gate is visible');
ok(disp('formIn') !== 'none', 'the sign-in form is visible');
ok(disp('formUp') === 'none', 'the register form is hidden');
ok(disp('shell') === 'none', 'the app shell is not rendering below it');

console.log('\n-- switching to the register tab');
doc.getElementById('formIn').hidden = true;
doc.getElementById('formUp').hidden = false;
ok(disp('formIn') === 'none', 'sign-in hides');
ok(disp('formUp') !== 'none', 'register shows');

console.log('\n-- after signing in');
doc.getElementById('gate').hidden = true;
doc.getElementById('shell').hidden = false;
ok(disp('gate') === 'none', 'the gate disappears completely');
ok(disp('shell') === 'grid', 'the app shell takes over');

console.log('\n-- only one thing on screen at a time');
const visibleTop = ['gate', 'shell'].filter(id => disp(id) !== 'none');
ok(visibleTop.length === 1, `exactly one of gate/shell is showing (${visibleTop.join(',') || 'none'})`);

console.log(fails ? `\n${fails} FAILURES` : '\nall green');
process.exit(fails ? 1 : 0);
