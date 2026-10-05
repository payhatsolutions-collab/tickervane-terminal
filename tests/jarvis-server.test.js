import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDashboard, healthSnapshot, HOST } from '../agents/jarvis/server.mjs';
import { Memory } from '../agents/jarvis/memory.mjs';
import { Bus } from '../agents/jarvis/bus.mjs';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let server, base, store, dir;

const evidence = [{ source: 'Yahoo Finance', value: 87.3, symbol: 'BZ=F' }];

before(async () => {
  store = new Memory(':memory:');
  dir = mkdtempSync(join(tmpdir(), 'jarvis-srv-'));
  const bus = new Bus(store, { dir });

  bus.emit({
    agent: 'macro', kind: 'observation', severity: 'elevated', confidence: 0.62,
    title: 'Brent +3.8% on Hormuz reports',
    subjects: [{ type: 'instrument', ref: 'BZ=F' }],
    evidence: [...evidence, { source: 'Reuters', url: 'https://example.com/a' }]
  });
  bus.emit({
    agent: 'momentum', kind: 'observation', severity: 'routine',
    title: 'TITAN enters top quintile', evidence
  });
  bus.emit({
    agent: 'options', kind: 'proposal', severity: 'notable',
    title: 'NIFTY bull call spread',
    action: { type: 'options_strategy', requiresApproval: false, payload: { netDebit: 4120 } },
    evidence
  });
  store.startRun({ taskId: 't1', agent: 'macro', intent: 'delta_scan' }, 'macro.intraday');
  store.endRun('t1', { status: 'ok', tokens: 1200, toolCalls: 5, signals: 2 });

  server = createDashboard({ store });
  await new Promise(r => server.listen(0, HOST, r));
  base = `http://${HOST}:${server.address().port}`;
});

after(async () => {
  await new Promise(r => server.close(r));
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = (path, init) => fetch(`${base}${path}`, init);

/**
 * Raw request, because fetch() silently drops a caller-supplied Host header —
 * it is a forbidden header name — and the rebinding guard reads exactly that.
 */
function rawGet(path, host) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: HOST, port: server.address().port, path, method: 'GET', headers: { Host: host }
    }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Independence: the dashboard is served by the daemon, from its own store.
// ---------------------------------------------------------------------------

test('serves its own dashboard page with no external dependencies', async () => {
  const res = await get('/');
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /<title>Jarvis<\/title>/);
  // Nothing is loaded from another origin — no CDN, no fonts, no framework.
  assert.doesNotMatch(html, /src="https?:\/\//, 'must not load external scripts');
  assert.doesNotMatch(html, /<link[^>]+href="https?:\/\//, 'must not load external stylesheets');
  assert.doesNotMatch(html, /alphanova/i, 'Jarvis is standalone, not part of another app');
});

test('signals come straight from the store, with their evidence', async () => {
  const j = await (await get('/api/signals')).json();
  assert.equal(j.signals.length, 3);
  const brent = j.signals.find(s => s.title.includes('Brent'));
  assert.equal(brent.evidence.length, 2);
  assert.equal(brent.severity, 'elevated');
});

test('signals can be filtered by agent', async () => {
  const j = await (await get('/api/signals?agent=momentum')).json();
  assert.deepEqual(j.signals.map(s => s.agent), ['momentum']);
});

test('health reports real run accounting', async () => {
  const j = await (await get('/api/health')).json();
  assert.equal(j.budget.tokens, 1200);
  assert.equal(j.budget.level, 'ok');
  assert.equal(j.agents[0].agent, 'macro');
  assert.equal(j.counts.elevated, 1);
  assert.equal(j.pending, 1);
});

test('a brief composes over the live store', async () => {
  const j = await (await get('/api/brief?kind=overnight')).json();
  assert.equal(j.label, 'Overnight');
  assert.ok(j.total >= 3);
});

test('an unknown brief kind is rejected', async () => {
  assert.equal((await get('/api/brief?kind=lunchtime')).status, 400);
});

// ---------------------------------------------------------------------------
// Approvals — possible here precisely because this is loopback, not a public site
// ---------------------------------------------------------------------------

test('approving records the decision and returns the ticket, not an order', async () => {
  const pending = (await (await get('/api/signals')).json()).pending;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].action.requiresApproval, true, 'forced true despite being emitted false');

  const res = await get('/api/decide', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signalId: pending[0].id, decision: 'approve' })
  });
  const j = await res.json();
  assert.equal(res.status, 200);
  assert.equal(j.decision, 'approve');
  assert.equal(j.ticket.netDebit, 4120, 'the ticket is handed back for you to place');

  const after = await (await get('/api/signals')).json();
  assert.equal(after.pending.length, 0, 'a decided proposal leaves the queue');
  assert.equal(store.decisionFor(pending[0].id).decision, 'approve');
});

test('deciding a non-proposal or unknown signal is refused', async () => {
  const body = (signalId, decision) => ({
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signalId, decision })
  });
  assert.equal((await get('/api/decide', body('sig_NOPE', 'approve'))).status, 404);

  const observation = (await (await get('/api/signals?agent=momentum')).json()).signals[0];
  assert.equal((await get('/api/decide', body(observation.id, 'approve'))).status, 400);
});

test('an invalid decision value is rejected', async () => {
  const res = await get('/api/decide', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signalId: 'sig_X', decision: 'yolo' })
  });
  assert.equal(res.status, 400);
});

test('decide refuses GET', async () => {
  assert.equal((await get('/api/decide')).status, 405);
});

// ---------------------------------------------------------------------------
// Local-only access
// ---------------------------------------------------------------------------

test('requests claiming another host are refused (DNS rebinding guard)', async () => {
  for (const host of ['evil.example.com', 'jarvis.attacker.test:7777']) {
    const res = await rawGet('/api/signals', host);
    assert.equal(res.status, 403, `${host} should be refused`);
    assert.match(res.body, /Local access only/);
  }
});

test('the guard also covers the page itself, not just the API', async () => {
  assert.equal((await rawGet('/', 'evil.example.com')).status, 403);
});

test('localhost and 127.0.0.1 hosts are both accepted', async () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    const res = await rawGet('/api/health', `${host}:${server.address().port}`);
    assert.equal(res.status, 200, `${host} should be allowed`);
  }
});

test('path traversal cannot escape the public directory', async () => {
  for (const path of ['/../../package.json', '/..%2f..%2fpackage.json', '/../memory.mjs']) {
    const res = await get(path);
    assert.ok(res.status === 403 || res.status === 404, `${path} returned ${res.status}`);
    const body = await res.text();
    assert.doesNotMatch(body, /"dependencies"/, `${path} leaked a file`);
  }
});

test('the page forbids external content and framing', async () => {
  const csp = (await get('/')).headers.get('content-security-policy');
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
});

test('healthSnapshot is the shape the page renders', () => {
  const snap = healthSnapshot(store);
  assert.ok(Number.isFinite(snap.budget.tokens));
  assert.ok(Array.isArray(snap.agents));
  assert.ok(['ok', 'degraded', 'critical'].includes(snap.budget.level));
});
