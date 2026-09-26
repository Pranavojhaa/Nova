import { createServer, type Server } from 'node:http';

/**
 * Minimal liveness endpoint for processes that are not web servers. Cloud Run only runs a
 * container that listens on a port, so the worker serves this and nothing else.
 */
export function startHealthServer(port: number, info: Record<string, string>): Promise<Server> {
  const body = JSON.stringify({ status: 'ok', ...info });
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      resolve(server);
    });
  });
}
