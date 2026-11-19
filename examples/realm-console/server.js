// Realm Console — local launcher. Node 18+, no dependencies.
// Serves console.html and forwards /proxy/* to the API, bound to 127.0.0.1 only.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT) || 5050;
const PAGE = path.join(__dirname, 'console.html');
const DEFAULT_UPSTREAM = 'https://democracy-sim-1.onrender.com/api/v1';
const HOP = new Set(['host', 'origin', 'referer', 'connection', 'content-length', 'x-upstream', 'accept-encoding', 'cookie']);

const server = http.createServer(async (req, res) => {
  // Reject anything not addressed to this machine (blocks DNS-rebinding from web pages).
  const host = (req.headers.host || '').split(':')[0];
  if (!['localhost', '127.0.0.1'].includes(host)) { res.writeHead(403); return res.end('Local only.'); }

  if (req.url === '/' || req.url.startsWith('/?') || req.url === '/console.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(PAGE).pipe(res);
  }

  if (req.url.startsWith('/proxy/')) {
    let upstream;
    try {
      upstream = new URL(req.headers['x-upstream'] || DEFAULT_UPSTREAM);
      if (!/^https?:$/.test(upstream.protocol)) throw 0;
    } catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'Bad base URL.' })); }

    const target = upstream.origin + upstream.pathname.replace(/\/+$/, '') + req.url.slice('/proxy'.length);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v;

    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;

    try {
      const r = await fetch(target, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
      const buf = Buffer.from(await r.arrayBuffer());
      res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/octet-stream' });
      return res.end(buf);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `Could not reach ${upstream.origin}: ${e.message}` }));
    }
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`Realm Console running at ${url}  (Ctrl+C to stop)`);
  const open = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(open, () => {});
});
