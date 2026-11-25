import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createAlphaNovaServer, createMarketReader } from '../lib/chatgptTools.js';
import { createMcpHandler, createRateLimiter } from '../api/mcp.js';

async function session(t, readMarket) {
  const server = createAlphaNovaServer({ readMarket });
  const client = new Client({ name: 'alphanova-test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}
const call = (client, name, args = {}) => client.callTool({ name, arguments: args });

test('MCP initializes and advertises ten strictly read-only tools', async t => {
  const client = await session(t, async () => { throw new Error('Unexpected read'); });
  assert.equal(client.getServerVersion().name, 'alphanova');
  const { tools } = await client.listTools();
  assert.equal(tools.length, 10);
  for (const tool of tools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
});

test('search resolves NSE company names and global tickers without suffix collisions', async t => {
  const client = await session(t, async () => ({ stocks: [{ symbol: 'RELIANCE', name: 'Reliance Industries' }, { symbol: 'AAPL', name: 'Indian Example' }], stale: true, fetchedAt: '2026-10-01', source: 'NSE' }));
  const result = (await call(client, 'search_instruments', { query: 'reliance' })).structuredContent;
  assert.equal(result.data.instruments[0].symbol, 'RELIANCE.NS');
  assert.equal(result.data.stale, true);
  assert.equal(result.data.fetchedAt, '2026-10-01');
  const apple = (await call(client, 'search_instruments', { query: 'AAPL' })).structuredContent.data.instruments;
  assert.deepEqual(apple.map(row => row.symbol), ['AAPL', 'AAPL.NS']);
});

test('quotes preserve nulls, market times, currency and partial failures', async t => {
  let query;
  const data = { quotes: [{ symbol: 'AAPL', price: null, currency: 'USD', marketTime: 1700000000, delay: 15 }], errors: [{ symbol: 'TCS.NS', error: 'Unavailable' }], fetchedAt: '2026-11-01' };
  const client = await session(t, async q => { query = q; return data; });
  const result = await call(client, 'get_quotes', { symbols: [' aapl ', 'TCS.NS', 'AAPL'] });
  assert.deepEqual(query, { op: 'quotes', symbols: 'AAPL,TCS.NS' });
  assert.deepEqual(result.structuredContent.data, data);
});

test('tool schemas reject URL injection, excessive batches and unknown fields before reads', async t => {
  let reads = 0;
  const client = await session(t, async () => { reads++; return {}; });
  for (const [name, args] of [
    ['get_quotes', { symbols: ['https://evil.example'] }],
    ['get_quotes', { symbols: Array(17).fill('AAPL') }],
    ['get_quotes', { symbols: ['AAPL'], url: 'https://evil.example' }],
    ['get_price_history', { symbol: 'AAPL', range: '100y' }],
    ['get_news', { symbol: 'AAPL', limit: 10000 }],
    ['screen_stocks', { preset: 'unknown' }],
    ['get_delivery', { symbol: 'AAPL?op=signup' }],
  ]) assert.equal((await call(client, name, args)).isError, true);
  assert.equal(reads, 0);
});

test('history reports truncation and rejects adjusted intraday before fetching', async t => {
  let reads = 0;
  const client = await session(t, async () => { reads++; return { bars: [{ time: '2026-10-01' }, { time: '2026-10-02' }], source: 'Yahoo Finance', fallback: true }; });
  const result = await call(client, 'get_price_history', { symbol: 'AAPL', maxBars: 1 });
  assert.equal(result.structuredContent.data.totalBars, 2);
  assert.equal(result.structuredContent.data.truncated, true);
  assert.equal(result.structuredContent.data.fallback, true);
  assert.deepEqual(result.structuredContent.data.bars, [{ time: '2026-10-02' }]);
  assert.equal((await call(client, 'get_price_history', { symbol: 'AAPL', range: '1d', adjusted: true })).isError, true);
  assert.equal(reads, 1);
});

test('screener applies the existing preset, sorts, limits and preserves coverage', async t => {
  const rows = [
    { symbol: 'ONE', breakout20: true, volRatio: 2, score: 80 },
    { symbol: 'TWO', breakout20: true, volRatio: 3, score: 90 },
    { symbol: 'THREE', breakout20: true, volRatio: 1, score: 100 },
    { symbol: 'FOUR', breakout20: true, volRatio: 2, score: null },
  ];
  const client = await session(t, async q => { assert.equal(q.op, 'screen'); return { rows, date: '2026-11-10', coverage: 497 }; });
  const result = (await call(client, 'screen_stocks', { preset: 'breakout20', limit: 1 })).structuredContent.data;
  assert.equal(result.totalMatches, 3);
  assert.equal(result.rows[0].symbol, 'TWO');
  assert.equal(result.coverage, 497);
  assert.equal(result.date, '2026-11-10');
});

test('remaining tools map to allowlisted reads and preserve source warnings', async t => {
  const queries = [];
  const client = await session(t, async q => { queries.push(q); return { source: 'Fixture', warning: 'Dated data', items: [{ title: 'One' }, { title: 'Two' }] }; });
  for (const name of ['get_fundamentals', 'get_company_research', 'get_delivery']) {
    const result = await call(client, name, { symbol: 'TCS.NS' });
    assert.equal(result.structuredContent.data.warning, 'Dated data');
  }
  assert.equal((await call(client, 'get_news', { symbol: 'AAPL', limit: 1 })).structuredContent.data.items.length, 1);
  await call(client, 'get_market_overview');
  await call(client, 'get_institutional_flows');
  assert.deepEqual(queries, [
    { op: 'fundamentals', symbol: 'TCS.NS' }, { op: 'lodestar', symbol: 'TCS.NS' },
    { op: 'delivery', symbol: 'TCS' }, { op: 'news', symbol: 'AAPL' }, { op: 'overview' }, { op: 'flows' },
  ]);
});

test('upstream errors and missing collections are tool errors, never empty successful results', async t => {
  const broken = await session(t, async () => { throw new Error('Source unavailable'); });
  assert.equal((await call(broken, 'get_quotes', { symbols: ['AAPL'] })).isError, true);
  const incomplete = await session(t, async () => ({}));
  assert.equal((await call(incomplete, 'screen_stocks', { preset: 'volume' })).isError, true);
});

test('market reader uses a fixed HTTPS API with no credentials, redirects or raw errors', async () => {
  const read = createMarketReader(async (url, options) => {
    assert.equal(url.origin, 'https://alphanova48.in');
    assert.equal(url.pathname, '/api/market');
    assert.equal(url.searchParams.get('symbol'), 'M&M.NS');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({ source: 'Fixture', price: null });
  });
  assert.deepEqual(await read({ op: 'fundamentals', symbol: 'M&M.NS' }), { source: 'Fixture', price: null });
  for (const response of [new Response('SECRET', { status: 500 }), new Response('<html>blocked</html>'), Response.json({ error: 'SECRET' }), new Response('not json', { headers: { 'Content-Type': 'application/json' } })]) {
    await assert.rejects(createMarketReader(async () => response)({ op: 'overview' }), error => !error.message.includes('SECRET'));
  }
  await assert.rejects(createMarketReader(async () => new Response('x'.repeat(4 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }))({ op: 'overview' }), /oversized/);
});

test('rate limiter expires windows and separates clients', () => {
  let now = 0;
  const limited = createRateLimiter({ now: () => now, max: 2 });
  assert.equal(limited('one'), false); assert.equal(limited('one'), false);
  assert.equal(limited('one'), true); assert.equal(limited('two'), false);
  now = 60000; assert.equal(limited('one'), false);
});

test('Streamable HTTP works across stateless requests using the official client', async t => {
  const handler = createMcpHandler({ serverFactory: () => createAlphaNovaServer({ readMarket: async () => ({ date: '2026-11-10', source: 'Fixture' }) }) });
  const http = createServer(handler);
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { http.closeAllConnections(); http.close(resolve); }));
  const url = new URL(`http://127.0.0.1:${http.address().port}/mcp`);
  const client = new Client({ name: 'http-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(url));
  t.after(() => client.close());
  assert.equal((await client.listTools()).tools.length, 10);
  assert.equal((await call(client, 'get_market_overview')).structuredContent.data.date, '2026-11-10');
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await fetch(url, { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(65537) })).status, 413);
  const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://chatgpt.com' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://chatgpt.com');
});
