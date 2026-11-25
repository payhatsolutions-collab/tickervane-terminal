import { createServer } from 'node:http';
import handler from '../api/mcp.js';

const port = Number(process.env.ALPHANOVA_MCP_PORT || 8787);
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/mcp' || path === '/api/mcp') {
    handler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  } else if (path === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ name: 'alphanova', version: '1.0.0', status: 'ok' }));
  } else { res.writeHead(404); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`AlphaNova MCP: http://127.0.0.1:${port}/mcp`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
