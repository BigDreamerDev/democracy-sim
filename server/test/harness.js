const Module = require('module');
/* Runs the real server against an in-process Postgres, so the tests exercise
   the actual constraints rather than a mock. */
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();

const orig = Module._load;
Module._load = function (req, ...a) {
  if (req === 'pg') {
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

process.env.PORT = '4321';
process.env.JWT_SECRET = 'x'.repeat(48);
require('../server.js');
