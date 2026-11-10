import test from 'node:test';
import assert from 'node:assert/strict';
import { clearCache, load } from '../src/hooks.js';
import { loadDailyChart, loadScreenChart } from '../src/screenChartFeed.js';

test('watchlist previews preserve global tickers, share cache, and limit upstream concurrency', async () => {
  clearCache();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = (url) => new Promise(resolve => requests.push({ url, resolve }));
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const finish = request => request.resolve({ ok: true, json: async () => ({ symbol: new URL(request.url, 'http://localhost').searchParams.get('symbol'), bars: [] }) });
  try {
    const symbols = ['RELIANCE.NS', 'AAPL', 'BTC-USD', '^NSEI', 'BZ=F'];
    const feeds = symbols.map(symbol => loadDailyChart(symbol));
    feeds.push(loadScreenChart('TCS'));
    await tick();
    assert.equal(requests.length, 3, 'at most three requests start before earlier requests finish');
    requests.slice().forEach(finish);
    await tick();
    assert.equal(requests.length, 6);
    requests.slice(3).forEach(finish);
    const data = await Promise.all(feeds);
    assert.deepEqual(data.map(item => item.symbol), [...symbols, 'TCS.NS']);
    assert.ok(requests.every(request => request.url.endsWith('&range=1y')));
    assert.equal((await loadDailyChart('AAPL')).symbol, 'AAPL');
    assert.equal(requests.length, 6, 'fresh feeds are reused across previews');
    const refreshed = loadDailyChart('AAPL', true);
    await tick();
    assert.equal(requests.length, 7, 'manual refresh bypasses the client cache');
    finish(requests[6]);
    await refreshed;
  } finally {
    globalThis.fetch = originalFetch;
    clearCache();
  }
});

test('duplicate queued forced previews share one request without consuming concurrency slots', async t => {
  clearCache();
  const requests = [];
  t.mock.method(globalThis, 'fetch', url => new Promise(resolve => requests.push({ url, resolve })));
  const finish = request => request.resolve({ ok: true, json: async () => ({ symbol: 'AAPL', bars: [] }) });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const work = Array.from({ length: 8 }, () => loadDailyChart('AAPL', true));
  work.push(loadDailyChart('TCS.NS', true));
  await tick();
  assert.equal(requests.length, 2, 'duplicates do not block a different stock');
  requests.forEach(finish);
  await tick();
  assert.equal(requests.length, 2, 'queued forced duplicates do not refetch after completion');
  await Promise.all(work);
  clearCache();
});

test('daily research cache survives navigation while intraday quotes stay fresh and refresh bypasses both', async t => {
  clearCache();
  let now = 1800000000000, calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ revision: ++calls }) }));
  const daily = '/api/market?op=chart&symbol=TCS.NS&range=1y';
  const intraday = '/api/market?op=chart&symbol=TCS.NS&range=1d';
  const quotes = '/api/market?op=quotes&symbols=TCS.NS';
  const first = await load(daily);
  await load(intraday); await load(quotes);
  now += 16000;
  assert.equal(await load(daily), first);
  assert.equal((await load(intraday)).revision, 4);
  assert.equal((await load(quotes)).revision, 5);
  assert.equal((await load(daily, true)).revision, 6);
  now += 300001;
  assert.equal((await load(daily)).revision, 7);
  clearCache();
});

test('failed preview requests remain retryable', async () => {
  clearCache();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: 'History unavailable' }) });
    await assert.rejects(loadDailyChart('AAPL'), /History unavailable/);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ symbol: 'AAPL', bars: [] }) });
    assert.equal((await loadDailyChart('AAPL', true)).symbol, 'AAPL');
  } finally {
    globalThis.fetch = originalFetch;
    clearCache();
  }
});
