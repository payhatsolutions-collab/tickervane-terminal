import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { chart, loadQuotes } from '../api/market.js';

const response = () => ({ ok: true, json: async () => ({ chart: { result: [{
  meta: { regularMarketPrice: 100 }, timestamp: [1704067200],
  indicators: { quote: [{ open: [100], high: [101], low: [99], close: [100] }] },
}] } }) });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const request = symbols => ({ method: 'GET', headers: {}, query: { op: 'quotes', symbols: symbols.join(',') } });
const reply = () => ({ headers: {}, code: 200, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(data) { return data; } });

test('overlapping chart and quote requests share upstream work without mixing ranges', async t => {
  let calls = 0;
  const gate = deferred();
  t.mock.method(globalThis, 'fetch', async () => { calls++; await gate.promise; return response(); });
  const requests = [chart('SHAREDQUOTE', '5d'), chart('SHAREDQUOTE', '5d'), chart('SHAREDQUOTE', '1y')];
  gate.resolve();
  const [a, b, c] = await Promise.all(requests);
  assert.equal(calls, 2);
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
});

test('a slow quote does not prevent idle workers from fetching the remaining symbols', async t => {
  const gate = deferred(), calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const symbol = new URL(url).pathname.split('/').at(-1);
    calls.push(symbol);
    if (symbol === 'SLOWWORKER') await gate.promise;
    return response();
  });
  const symbols = ['SLOWWORKER', 'WORKERA', 'WORKERB', 'WORKERC', 'WORKERD', 'WORKERE'];
  const pending = handler(request(symbols), reply());
  await turn();
  const started = [...calls];
  gate.resolve();
  const result = await pending;
  assert.ok(started.includes('WORKERE'), 'fast symbols must not wait for the slow first symbol');
  assert.equal(result.quotes.length, symbols.length);
});

test('failed quote batches cannot be cached as successful market data', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false }));
  const res = reply();
  const data = await handler(request(['UNAVAILABLEQUOTE']), res);
  assert.equal(res.code, 503);
  assert.ok(data.error);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('failed shared chart requests can be retried', async t => {
  let unavailable = true, calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return unavailable ? { ok: false } : response(); });
  await assert.rejects(chart('RETRYSHARED', '5d'), /unavailable/);
  unavailable = false;
  assert.equal((await chart('RETRYSHARED', '5d')).price, 100);
  assert.equal(calls, 3);
});

test('a stalled upstream yields partial quotes before the request deadline', async () => {
  const gate = deferred();
  const symbols = ['STALLED', 'QUICKA', 'QUICKB', 'QUICKC', 'QUICKD'];
  const result = await loadQuotes(symbols, async symbol => {
    if (symbol === 'STALLED') await gate.promise;
    return { symbol, price: 100, bars: [{ close: 100 }] };
  }, 20);
  assert.deepEqual(result.quotes.map(q => q.symbol), symbols.slice(1));
  assert.deepEqual(result.errors, ['STALLED']);
  gate.resolve();
  await turn();
  assert.equal(result.quotes.length, 4, 'late requests must not mutate a returned response');
});
