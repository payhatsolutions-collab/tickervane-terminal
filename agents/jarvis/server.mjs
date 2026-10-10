// The Jarvis dashboard server.
//
// Standalone and local: the daemon serves its own dashboard from its own store.
// Nothing is published to any website, and no other application hosts it.
//
// Bound to 127.0.0.1 only, so it is not reachable from the network. Because the
// dashboard and the daemon share an origin, approvals can be made in the browser
// — the reason the earlier "no mutating route" constraint existed was that a
// public site cannot be trusted with them. A loopback server can.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { Memory } from './memory.mjs';
import { compose, BRIEFS } from './brief.mjs';
import { DAILY_TOKEN_BUDGET } from './config.mjs';
import { istDayStart } from './runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, 'public');
export const PORT = Number(process.env.JARVIS_PORT) || 7777;
export const HOST = '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

/** Health for the dashboard's agent column and budget meter. */
export function healthSnapshot(store) {
  const since = istDayStart();
  const spend = store.spendSince(since);
  const used = spend.tokens / DAILY_TOKEN_BUDGET;
  return {
    updatedAt: new Date().toISOString(),
    budget: {
      tokens: spend.tokens, limit: DAILY_TOKEN_BUDGET,
      level: used >= 0.95 ? 'critical' : used >= 0.8 ? 'degraded' : 'ok',
      toolCalls: spend.toolCalls, runs: spend.runs
    },
    agents: store.agentHealth().map(a => ({
      agent: a.agent, status: a.status, intent: a.intent,
      startedAt: a.started_at, signals: a.signals, error: a.error
    })),
    counts: Object.fromEntries(
      ['routine', 'notable', 'elevated', 'urgent']
        .map(sev => [sev, store.countSignalsSince(since, { severity: sev })])
    ),
    pending: store.pendingApprovals().length
  };
}

/**
 * Only same-machine callers. A browser on another host cannot reach 127.0.0.1,
 * but a page the user visits could try to address this server by a hostname
 * that resolves to it (DNS rebinding), so the Host header is checked too.
 */
function localHost(req) {
  const host = String(req.headers.host || '');
  const name = host.replace(/:\d+$/, '');
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]' || name === '::1';
}

async function readBody(req, limit = 64e3) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new Error('Body too large');
  }
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(res, urlPath) {
  // normalize + prefix check: nothing outside public/ can be read.
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end('Forbidden'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      // The dashboard is entirely self-contained: no external scripts, styles,
      // fonts or images, and no framing.
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

export function createDashboard({ store = new Memory(), onDecision = null } = {}) {
  const json = (res, code, data) => {
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(JSON.stringify(data));
  };

  const server = createServer(async (req, res) => {
    if (!localHost(req)) return json(res, 403, { error: 'Local access only' });

    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const path = url.pathname;

    try {
      if (path === '/api/signals') {
        const limit = Math.max(1, Math.min(300, Number(url.searchParams.get('limit')) || 80));
        return json(res, 200, {
          signals: store.listSignals({
            agent: url.searchParams.get('agent') || undefined,
            severity: url.searchParams.get('severity') || undefined,
            kind: url.searchParams.get('kind') || undefined,
            since: url.searchParams.get('since') || undefined,
            limit
          }),
          pending: store.pendingApprovals(),
          updatedAt: new Date().toISOString()
        });
      }

      if (path === '/api/health') return json(res, 200, healthSnapshot(store));

      if (path === '/api/brief') {
        const kind = url.searchParams.get('kind') || 'overnight';
        if (!BRIEFS[kind]) return json(res, 400, { error: `Unknown brief "${kind}"` });
        const since = new Date(Date.now() - (BRIEFS[kind].hours + 2) * 3600_000).toISOString();
        return json(res, 200, compose(kind, store.listSignals({ since, limit: 500 })));
      }

      if (path === '/api/watchlist') {
        if (req.method === 'GET') return json(res, 200, { watchlist: store.getWatchlist() });
        if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' });
        const body = await readBody(req);
        if (Array.isArray(body.add)) {
          const r = store.addToWatchlist(body.add.slice(0, 50), 'manual');
          return json(res, 200, { ...r, watchlist: store.getWatchlist() });
        }
        if (typeof body.remove === 'string') {
          const removed = store.removeFromWatchlist(body.remove);
          return json(res, removed ? 200 : 404, { removed, watchlist: store.getWatchlist() });
        }
        return json(res, 400, { error: 'Send {add: ["SYMBOL"]} or {remove: "SYMBOL"}' });
      }

      if (path === '/api/decide') {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
        const body = await readBody(req);
        const { signalId, decision } = body;
        if (!['approve', 'dismiss'].includes(decision)) {
          return json(res, 400, { error: 'decision must be approve or dismiss' });
        }
        const signal = store.getSignal(signalId);
        if (!signal) return json(res, 404, { error: 'No such signal' });
        if (!signal.action?.requiresApproval) {
          return json(res, 400, { error: 'That signal is not awaiting approval' });
        }
        store.recordDecision(signalId, decision);
        onDecision?.(signal, decision);
        // Approving records the decision and hands back the ticket. It does not
        // transmit an order — Jarvis never does.
        return json(res, 200, {
          ok: true, decision,
          ticket: decision === 'approve' ? signal.action.payload : null
        });
      }

      if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });
      return serveStatic(res, path);
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  });

  return server;
}

export function startDashboard(options = {}) {
  const server = createDashboard(options);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? PORT, HOST, () => resolve(server));
  });
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  startDashboard().then(s => {
    const { port } = s.address();
    console.log(`Jarvis dashboard on http://${HOST}:${port}`);
  }).catch(e => { console.error(e.message); process.exit(1); });
}
