/* A curated, versioned, CORS-open mirror of state this Republic already
   publishes unauthenticated elsewhere — for a stock ticker, a newspaper, a
   casino settling its own side-bets, or whatever else somebody who isn't the
   official front end wants to build.

   Every read here is a loopback re-fetch of a route this same process already
   serves without auth. That is deliberate, not laziness: those routes are
   exactly the ones opacity.mjs already asserts never carry a real place name
   or ISO code, and re-reading them means this mirror can never diverge from —
   or leak more than — what they already guarantee. Nothing here queries a
   table directly, and nothing here can move money; that surface is the
   API-key routes in server.js, not this one.

   CORS is opened here and ONLY here (`Access-Control-Allow-Origin: *`). The
   rest of the app stays locked to ALLOWED_ORIGINS — see cors() in server.js. */

const http = require('http');
const crypto = require('crypto');

module.exports.mount = function mount(app, ctx) {
  const { events } = ctx;
  const PORT = process.env.PORT || 3000;

  /* Read traffic is meant to be hit often — that's the whole point of a
     stable public mirror — so this is far looser than the write throttles in
     server.js, which exist to slow down guessing, not to protect a database
     that isn't being touched here at all. */
  const buckets = new Map();
  function allow(ip) {
    const now = Date.now();
    const b = buckets.get(ip);
    if (!b || now > b.reset) { buckets.set(ip, { n: 1, reset: now + 60000 }); return true; }
    if (b.n >= 300) return false;
    b.n++; return true;
  }
  setInterval(() => { const t = Date.now(); for (const [k, v] of buckets) if (t > v.reset) buckets.delete(k); }, 60000).unref();
  const ip = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'local';

  const router = require('express').Router();
  router.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (!allow(ip(req))) return res.status(429).json({ error: 'Too many requests. Slow down and try again shortly.' });
    next();
  });
  app.use('/api/public/v1', router);

  /* Re-reads an already-public route of this same server over loopback. A
     404 from the catch-all (module not mounted, e.g. no diplomacy schema)
     becomes a 503 here, matching how every optional module already degrades
     rather than inventing a number for something that isn't installed. */
  function mirror(internalPath) {
    return new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: PORT, path: internalPath, timeout: 5000 }, res => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => {
          let data; try { data = JSON.parse(body); } catch { data = null; }
          resolve({ status: res.statusCode, data });
        });
      }).on('error', reject).on('timeout', function () { this.destroy(new Error('upstream timeout')); });
    });
  }

  function sendMirrored(res, upstream, { notMountedAs = 'This feature is not enabled on this Republic.' } = {}) {
    if (upstream.status === 404) return res.status(503).json({ error: notMountedAs });
    if (upstream.status >= 400 || upstream.data == null)
      return res.status(502).json({ error: 'Could not read that from the Republic right now.' });
    const body = JSON.stringify(upstream.data);
    const etag = '"' + crypto.createHash('sha1').update(body).digest('hex') + '"';
    res.set('Cache-Control', 'public, max-age=5');
    res.set('ETag', etag);
    if (res.req.headers['if-none-match'] === etag) return res.status(304).end();
    res.type('application/json').send(body);
  }

  const relay = (internalPath, opts) => async (req, res) => {
    try {
      sendMirrored(res, await mirror(internalPath + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')), opts);
    } catch {
      res.status(502).json({ error: 'Could not read that from the Republic right now.' });
    }
  };

  router.get('/economy', relay('/api/economy'));
  router.get('/bills', relay('/api/bills'));
  router.get('/elections', relay('/api/elections'));
  router.get('/map', relay('/api/diplomacy/map', { notMountedAs: 'Diplomacy is not enabled on this Republic.' }));
  router.get('/powers', relay('/api/diplomacy/powers', { notMountedAs: 'Diplomacy is not enabled on this Republic.' }));
  router.get('/treaties', relay('/api/diplomacy/treaties', { notMountedAs: 'Diplomacy is not enabled on this Republic.' }));
  router.get('/conflicts', relay('/api/diplomacy/conflicts', { notMountedAs: 'Diplomacy is not enabled on this Republic.' }));
  router.get('/war', relay('/api/war', { notMountedAs: 'The war system is not enabled on this Republic.' }));
  router.get('/war/conflicts', relay('/api/war/conflicts', { notMountedAs: 'The war system is not enabled on this Republic.' }));

  /* -------------------------------------------------------- live events */

  /* Which audit action kinds are worth a third party's attention. Most of
     the audit table is administrative noise — an account approved, a password
     changed, a config value nudged — nobody outside the Republic needs to
     hear about in real time. This is the public, curated subset: a bill
     reaching a public outcome, an election result made official, a listing
     or dividend changing hands, a war stage moving, a dispatch going out. */
  const BROADCAST = new Set([
    'bill.close', 'bill.veto', 'bill.casting', 'rule.change',
    'election.certify', 'election.status',
    'economy.found', 'economy.buy', 'market.issue', 'market.dividend', 'economy.dividend',
    'war.escalate', 'war.procure',
    'foreign.dispatch', 'foreign.treaty.propose', 'foreign.recognise'
  ]);

  // A popular integration polling this hard shouldn't be able to take the
  // process down with it; this is a blunt in-memory cap, not a queue.
  const MAX_SSE = 200;
  let sseCount = 0;

  router.get('/events', (req, res) => {
    if (sseCount >= MAX_SSE) return res.status(503).json({ error: 'Too many live listeners right now. Try again shortly.' });
    sseCount++;
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();
    res.write(': connected\n\n');

    const onAudit = row => {
      if (!BROADCAST.has(row.action)) return;
      // detail is a free-text note a citizen or an officer wrote; it is
      // already public the moment it lands in the audit table, same as every
      // other reader of /api/state sees it.
      res.write(`event: ${row.action}\ndata: ${JSON.stringify({ action: row.action, detail: row.detail, at: row.at })}\n\n`);
    };
    events.on('audit', onAudit);

    // Keeps a proxy (nginx, Render's own edge) from deciding an idle stream
    // is dead and closing it out from under a client that is still listening.
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 20000);

    req.on('close', () => {
      clearInterval(heartbeat);
      events.off('audit', onAudit);
      sseCount--;
    });
  });
};
