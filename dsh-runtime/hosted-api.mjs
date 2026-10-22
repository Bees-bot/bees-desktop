import { createServer, request } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

/** Expose only the authenticated Bees API; the upstream runtime stays on loopback. */
export function createClientProxy({ port, token }) {
  const paths = new Set(['/bees-api/threads', '/bees-api/snapshot', '/bees-api/thread-file', '/bees-api/active-runs']);
  return createServer((req, res) => {
    const reply = (status, error) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ error })); };
    const path = new URL(req.url, 'http://client').pathname;
    const health = path === '/healthz' && req.method === 'GET';
    if (!health && !paths.has(path)) return reply(404, 'Unavailable');
    if (!health) {
      const offered = Buffer.from(String(req.headers.authorization ?? '')), expected = Buffer.from('Bearer ' + token);
      if (req.headers.origin || offered.length !== expected.length || !timingSafeEqual(offered, expected)) return reply(401, 'Unauthorized');
      if (!['GET', 'POST'].includes(req.method)) return reply(405, 'Method not allowed');
    }
    const upstream = request({ hostname: '127.0.0.1', port, path: req.url, method: req.method, timeout: 65000,
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > 16_000_000) { if (!res.headersSent) reply(413, 'Request too large'); upstream.destroy(); } });
    upstream.on('timeout', () => upstream.destroy(Error('Client request timed out')));
    upstream.on('error', () => { if (!res.headersSent) reply(503, 'Client is starting. Try again shortly.'); else if (!res.writableEnded) res.destroy(); });
    res.on('close', () => upstream.destroy()); req.pipe(upstream);
  });
}
