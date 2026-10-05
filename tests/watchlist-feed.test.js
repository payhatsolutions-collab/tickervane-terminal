import test from 'node:test';
import assert from 'node:assert/strict';
import { clearCache } from '../src/hooks.js';
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
