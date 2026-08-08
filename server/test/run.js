/* npm test — boots a fresh server with an empty database for each suite, so no
   suite can be affected by another. Needs: npm install @electric-sql/pglite */
const { spawn, spawnSync } = require('child_process');
const path = require('path');

const SUITES = ['functional.mjs', 'attack.mjs', 'rules.mjs', 'speaker.mjs', 'flag.mjs'];

const up = async () => {
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch('http://localhost:4321/api/health')).ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
};

(async () => {
  let bad = 0;
  for (const suite of SUITES) {
    console.log(`\n=== ${suite} ===`);
    const srv = spawn(process.execPath, [path.join(__dirname, 'harness.js')], { stdio: 'ignore' });
    if (!await up()) { console.error('server never came up'); srv.kill(); process.exit(1); }
    const r = spawnSync(process.execPath, [path.join(__dirname, suite)], { stdio: 'inherit' });
    if (r.status !== 0) bad++;
    srv.kill();
    await new Promise(r => setTimeout(r, 400));
  }
  console.log(bad ? `\n${bad} suite(s) failed` : '\nAll suites green');
  process.exit(bad ? 1 : 0);
})();
