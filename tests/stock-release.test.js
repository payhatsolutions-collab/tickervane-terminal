import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSymbol } from '../src/symbols.js';
import { viewFromLocation, viewURL } from '../src/navigation.js';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { clearCache, load, loadQuoteSet, useFeed } from '../src/hooks.js';
import { buildOverview } from '../lib/overview.js';
import { candlesFromSessions } from '../lib/nseHistory.js';
import { chart } from '../api/market.js';
import { readFileSync } from 'node:fs';

test('bare NSE stock links normalize before requests and remain shareable', () => {
  for (const symbol of ['RELIANCE', 'HDFCBANK', 'M&M']) {
    const view = viewFromLocation(new URL('https://example.com/charts?symbol=' + encodeURIComponent(symbol)));
    assert.equal(view.symbol, symbol + '.NS');
    assert.deepEqual(viewFromLocation(new URL(viewURL('https://example.com/', view, { share: false }), 'https://example.com')), view);
  }
  for (const symbol of ['AAPL', '^NSEI', 'BTC-USD', 'BZ=F', 'RELIANCE.NS']) assert.equal(normalizeSymbol(symbol), symbol);
});
test('six-month and yearly views share one normalized history request', async t => {
  clearCache(); const urls = [];
  const bars = ['2025-11-04', '2026-02-04', '2026-05-04', '2026-11-04'].map(time => ({ time, close: 100 }));
  t.mock.method(globalThis, 'fetch', async url => { urls.push(url); return { ok: true, json: async () => ({ bars }) }; });
  const [half, year] = await Promise.all([load('/api/market?op=chart&symbol=HDFCBANK&range=6mo'), load('/api/market?op=chart&symbol=HDFCBANK.NS&range=1y')]);
  assert.deepEqual(urls, ['/api/market?op=chart&symbol=HDFCBANK.NS&range=1y']);
  assert.equal(half.bars.length, 2); assert.equal(year.bars.length, 4);
  function CachedView() { const feed = useFeed('/api/market?op=chart&symbol=HDFCBANK&range=6mo'); return React.createElement('span', null, feed.data?.bars.length); }
  assert.equal(renderToStaticMarkup(React.createElement(CachedView)), '<span>2</span>');
  t.mock.method(globalThis, 'fetch', async () => { throw Error('Offline'); });
  await assert.rejects(load('/api/market?op=chart&symbol=HDFCBANK&range=6mo', true), /Offline/);
  assert.equal(renderToStaticMarkup(React.createElement(CachedView)), '<span>2</span>');
  clearCache();
});
test('overlapping quote consumers request each symbol once and signup status is shared', async t => {
  clearCache(); const urls = [];
  t.mock.method(globalThis, 'fetch', async url => { urls.push(url); const p = new URL(url, 'https://example.com').searchParams;
    return { ok: true, json: async () => ({ configured: true, quotes: (p.get('symbols') || '').split(',').map(symbol => ({ symbol, price: 100 })) }) };
  });
  const [a, b] = await Promise.all([loadQuoteSet(['^NSEI', 'HDFCBANK.NS']), loadQuoteSet(['^NSEI'])]);
  assert.equal(urls.length, 1); assert.equal(a.quotes.length, 2); assert.equal(b.quotes.length, 1);
  await loadQuoteSet(['^NSEI']); assert.equal(urls.length, 1);
  await Promise.all([load('/api/signup?op=status'), load('/api/signup?op=status')]); assert.equal(urls.length, 2);
  clearCache();
});

test('short daily chart ranges include the last day of a shorter starting month', async t => {
  for (const [range, end, expected, previous] of [
    ['1mo', '2025-03-31', '2025-02-28', '2025-02-27'],
    ['3mo', '2024-05-31', '2024-02-29', '2024-02-28'],
    ['6mo', '2025-10-31', '2025-04-30', '2025-04-29'],
    ['1mo', '2025-01-20', '2024-12-20', '2024-12-19'],
  ]) {
    clearCache();
    const bars = [previous, expected, end].map(time => ({ time, close: 100 }));
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ bars }) }));
    const view = await load('/api/market?op=chart&symbol=TCS.NS&range=' + range);
    assert.deepEqual(view.bars.map(bar => bar.time), [expected, end]);
  }
  clearCache();
});
test('Yahoo outage returns dated real NSE OHLC, never adjusted or invented candles', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false }));
  const data = await chart('HDFCBANK', '1y');
  assert.equal(data.symbol, 'HDFCBANK.NS'); assert.ok(data.fallback); assert.ok(data.bars.length >= 15);
  assert.match(data.source, /NSE/); assert.equal(data.asOf, data.bars.at(-1).time);
  assert.equal(new Set(data.bars.map(bar => bar.time)).size, data.bars.length);
  assert.ok(data.bars.every(bar => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)));
  await assert.rejects(chart('HDFCBANK.NS', '1y', true), /unavailable/);
  assert.deepEqual(candlesFromSessions([{ date: '2026-11-04', rows: new Map([['TCS', { high: 10, low: 5, close: 8 }]]) }], 'TCS.NS'), []);
});
test('overview retains full-universe breadth and counts in a small response', () => {
  const { screen } = JSON.parse(readFileSync('content/stock-snapshot.json', 'utf8'));
  const overview = buildOverview(screen);
  assert.equal(overview.metrics.total, screen.rows.length);
  assert.ok(!('rows' in overview));
  assert.ok(Object.values(overview.setups).every(setup => setup.rows.length <= 6 && setup.count >= setup.rows.length));
  assert.ok(Buffer.byteLength(JSON.stringify(overview)) < 6500);
});

test('setup levels use the breakout threshold or signal-session high and a 2R target', () => {
  const row = {
    symbol: 'ABC', breakout20: true, volRatio: 2, golden: true, above200: true,
    r1w: -2, rsi: 47, delivRatio: 2, delivPct: 55, change: 1,
    prior20High: 103.10, sessionHigh: 107.25, meanTrueRange14: 3.15,
  };
  const { setups } = buildOverview({ rows: [row] });
  assert.deepEqual(setups.breakout20.rows[0].levels, { pivot: 103.10, stop: 99.95, target: 109.40 });
  for (const id of ['pullback', 'accumulation']) {
    assert.deepEqual(setups[id].rows[0].levels, { pivot: 107.25, stop: 104.10, target: 113.55 });
  }
  const incomplete = buildOverview({ rows: [{ ...row, prior20High: null, meanTrueRange14: null }] });
  assert.equal(incomplete.setups.breakout20.rows[0].levels, null);
  assert.deepEqual(incomplete.setups.pullback.rows[0].levels, { pivot: 107.25 });
});
