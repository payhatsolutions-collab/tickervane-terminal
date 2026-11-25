import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createAlphaNovaServer } from '../lib/chatgptTools.js';

const MAX_BODY_BYTES = 65536;
const ORIGINS = new Set(['https://chatgpt.com', 'https://alphanova48.in', 'http://127.0.0.1:8787', 'http://localhost:8787']);

export function createRateLimiter({ now = Date.now, max = 60 } = {}) {
  const entries = new Map();
  return ip => {
    const time = now();
    for (const [key, entry] of entries) if (time >= entry.until) entries.delete(key);
    let entry = entries.get(ip);
    if (!entry) {
      if (entries.size >= 10000) return true;
      entry = { count: 0, until: time + 60000 };
      entries.set(ip, entry);
    }
    return ++entry.count > max;
  };
}

function reply(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

async function parseBody(req) {
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) throw Object.assign(new Error('Request too large'), { status: 413 });
  // Vercel may already have parsed the body; local Node and Vite use the stream.
  if (req.body !== undefined) {
    const text = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw Object.assign(new Error('Request too large'), { status: 413 });
    return JSON.parse(text);
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createMcpHandler({ serverFactory = createAlphaNovaServer, rateLimited = createRateLimiter() } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Origin');
    const origin = req.headers.origin;
    if (origin && !ORIGINS.has(origin)) return reply(res, 403, 'Origin not allowed');
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, MCP-Protocol-Version, MCP-Session-Id, Accept');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS');
      return reply(res, 405, 'Use MCP Streamable HTTP POST. This stateless server has no SSE stream.');
    }
    // Vercel supplies the client IP; local servers use the socket, not spoofable forwarding headers.
    const ip = (process.env.VERCEL ? req.headers['x-forwarded-for']?.split(',')[0]?.trim() : null) || req.socket?.remoteAddress || 'unknown';
    if (rateLimited(ip)) { res.setHeader('Retry-After', '60'); return reply(res, 429, 'Too many requests. Retry in one minute.'); }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return reply(res, 415, 'Content-Type must be application/json');
    let body;
    try { body = await parseBody(req); }
    catch (error) { return reply(res, error.status || 400, error.status === 413 ? 'Request too large' : 'Invalid JSON'); }
    const server = serverFactory();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.once('close', () => { void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) reply(res, 500, 'MCP request failed');
      else if (!res.writableEnded) res.end();
    } finally {
      await server.close();
    }
  };
}

export default createMcpHandler();
