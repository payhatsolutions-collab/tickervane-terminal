import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { chart } from '../api/market.js';

test('quote cache expires after 15 seconds and API does not allow stale CDN quotes', async t => {
  let now = 1800000000000, calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return { ok: true, json: async () => ({ chart: { result: [{
      meta: { regularMarketPrice: 100 + calls, previousClose: 100, regularMarketTime: Math.floor(now / 1000) },
      timestamp: [1704067200], indicators: { quote: [{ open: [100], high: [110], low: [99], close: [101] }] },
    }] } }) };
  });
  const first = await chart('REFRESHTEST', '5d');
  now += 14000;
  assert.equal((await chart('REFRESHTEST', '5d')).price, first.price);
  assert.equal(calls, 1);
  now += 2000;
  assert.equal((await chart('REFRESHTEST', '5d')).price, 102);
  const headers = {};
  const result = await handler({ method: 'GET', query: { op: 'quotes', symbols: 'REFRESHTEST' }, headers: {} }, {
    setHeader(k, v) { headers[k] = v; }, status() { return this; }, json(d) { return d; },
  });
  assert.equal(result.quotes[0].price, 102);
  assert.equal(headers['Cache-Control'], 'public, max-age=0, s-maxage=15');
});
