const Module = require('module');
/* Runs the real server against an in-process Postgres, so the tests exercise
   the actual constraints rather than a mock. */
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();

const orig = Module._load;
Module._load = function (req, ...a) {
  if (req === 'pg') {
    /* PGlite is one in-process connection, so there is no `connect()` to give.
       Leaving it off is deliberate: tx() sees no connect and falls back to
       running BEGIN/COMMIT on the pool itself with overlapping transactions
       queued, which is the only thing a single connection can honestly do.
       Real deployments get a connection per transaction out of the pg pool. */
    return {
      Pool: class {
        async query(sql, params) {
          if (!params || !params.length) {
            const r = await db.exec(sql);
            return r[r.length - 1] || { rows: [] };
          }
          return db.query(sql, params);
        }
      }
    };
  }
  return orig.call(this, req, ...a);
};

process.env.PORT = process.env.TEST_PORT || '4321';
process.env.JWT_SECRET = 'x'.repeat(48);
require('../server.js');
