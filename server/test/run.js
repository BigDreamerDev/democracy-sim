/* npm test — boots a fresh server with an empty database for each suite, so no
   suite can be affected by another. Needs: npm install @electric-sql/pglite */
const { spawn, spawnSync } = require('child_process');
const path = require('path');

const SUITES = ['functional.mjs', 'attack.mjs', 'rules.mjs', 'speaker.mjs', 'flag.mjs', 'powers.mjs', 'houserule.mjs', 'initiative.mjs', 'emergency.mjs', 'people.mjs', 'pm.mjs', 'acts.mjs', 'bank.mjs', 'money.mjs', 'justice.mjs', 'diplomacy.mjs', 'foreigntrade.mjs', 'worldmap.mjs', 'foreignoffice.mjs', 'billedit.mjs', 'war.mjs', 'conflict.mjs', 'runoff.mjs', 'opacity.mjs', 'export.mjs', 'worldgen.mjs', 'offshore.mjs', 'government.mjs', 'intelligence.mjs'];

/* TEST_PORT lets two runs happen at once on one machine without fighting over
   the socket. Unset, everything behaves exactly as it did. */
const PORT = process.env.TEST_PORT || '4321';

const up = async () => {
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) return true; } catch {}
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
