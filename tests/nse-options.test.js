import test from 'node:test';
import assert from 'node:assert/strict';
import { createNseOptionsClient, optionDate, parseLiveOptions } from '../lib/nseOptions.js';
import { optionFreshness, optionSignal } from '../src/optionSignal.js';
import handler from '../api/market.js';

const now = Date.parse('2026-10-07T06:30:30Z'); // 12:00:30 IST
const expiry = '2026-10-13';
const fixture = () => ({ records: {
  timestamp: '07-Oct-2026 12:00:00', underlyingValue: 100,
  data: [98, 100, 102].map(strikePrice => ({ strikePrice, expiryDates: '13-Oct-2026',
    CE: { underlying: 'NIFTY', expiryDate: '13-10-2026', openInterest: 100, changeinOpenInterest: 5, totalTradedVolume: 20, lastPrice: 5, impliedVolatility: 12, buyPrice1: 4.9, sellPrice1: 5.1, pChange: -2 },
    PE: { underlying: 'NIFTY', expiryDate: '13-10-2026', openInterest: 200, changeinOpenInterest: 50, totalTradedVolume: 30, lastPrice: 4, impliedVolatility: 14, buyPrice1: 3.9, sellPrice1: 4.1, pChange: 3 },
  })),
} });
const response = data => ({ ok: true, status: 200, json: async () => data });

test('NSE v3 parsing preserves contract units, quotes, IST time and expiry isolation', () => {
  const input = fixture();
  input.records.data.push({ ...input.records.data[0], expiryDates: '27-Oct-2026', strikePrice: 1000 });
  const d = parseLiveOptions(input, 'NIFTY', expiry, [expiry], now);
  assert.equal(d.rows.length, 3);
  assert.equal(d.asOf, '2026-10-07T06:30:00.000Z');
  assert.equal(d.rows[0].CE.oi, 100);
  assert.equal(d.rows[0].PE.bid, 3.9);
  assert.equal(d.rows[0].CE.iv, 12);
  assert.equal(d.straddle, 9);
  assert.equal(d.pcr, 2);
  assert.equal(d.freshness, 'live');
  assert.equal(d.signal.label, 'Bullish');
  assert.equal(optionDate('31-Feb-2026'), null);
  assert.equal(optionDate('13-10-2026'), expiry);
  assert.throws(() => parseLiveOptions({}, 'NIFTY', expiry), /incomplete/);
  assert.throws(() => parseLiveOptions(input, 'OTHER', expiry), /no contracts/);
});

test('missing and zero quotes remain unavailable; missing OI never becomes a range signal', () => {
  const input = fixture();
  input.records.data.forEach(r => { r.CE.lastPrice = 0; r.CE.openInterest = null; r.CE.impliedVolatility = 0; r.CE.buyPrice1 = ''; });
  const d = parseLiveOptions(input, 'NIFTY', expiry, [expiry], now);
  assert.equal(d.rows[0].CE.oi, null);
  assert.equal(d.rows[0].CE.close, null);
  assert.equal(d.rows[0].CE.iv, null);
  assert.equal(d.rows[0].CE.bid, null);
  assert.equal(d.pcr, null);
  assert.equal(d.straddle, null);
  assert.equal(d.callWall, null);
  assert.equal(d.signal.label, 'Unavailable');
});

test('signal distinguishes bullish, bearish, mixed/range and thin chains', () => {
  const chain = parseLiveOptions(fixture(), 'NIFTY', expiry, [expiry], now);
  chain.maxPain = 100;
  assert.equal(optionSignal(chain).label, 'Bullish');
  chain.rows.forEach(r => { [r.CE, r.PE] = [r.PE, r.CE]; });
  assert.equal(optionSignal(chain).label, 'Bearish');
  chain.rows.forEach(r => { r.CE.oi = r.PE.oi = 100; r.CE.chg = r.PE.chg = 10; });
  assert.equal(optionSignal(chain).label, 'Range');
  chain.rows = chain.rows.slice(0, 2);
  assert.equal(optionSignal(chain).label, 'Unavailable');
  assert.equal(optionSignal(null).label, 'Unavailable');
});

test('signal excludes distant strikes and withholds the change vote when incomplete', () => {
  const chain = parseLiveOptions(fixture(), 'NIFTY', expiry, [expiry], now);
  chain.maxPain = 100;
  chain.rows.push({ strike: 200, CE: { oi: 1e9, chg: 1e9 }, PE: { oi: 1, chg: 0 } });
  assert.equal(optionSignal(chain).label, 'Bullish');
  chain.rows[0].PE.chg = null;
  assert.equal(optionSignal(chain).label, 'Range');
  assert.match(optionSignal(chain).reasons[1], /withheld/);
});

test('exchange age controls freshness, including future clocks and weekends', () => {
  assert.equal(optionFreshness('2026-10-07T06:30:00Z', now), 'live');
  assert.equal(optionFreshness('2026-10-07T06:20:00Z', now), 'stale');
  assert.equal(optionFreshness('2026-10-07T07:00:00Z', now), 'unavailable');
  assert.equal(optionFreshness(null, now), 'unavailable');
  assert.equal(optionFreshness('2026-10-07T10:10:00Z', Date.parse('2026-10-07T13:00:00Z')), 'snapshot');
  assert.equal(optionFreshness('2026-10-09T10:10:00Z', Date.parse('2026-10-10T06:00:00Z')), 'snapshot');
  assert.equal(optionFreshness('2026-10-07T10:10:00Z', Date.parse('2026-10-08T04:00:00Z')), 'stale');
});

test('v3 requests use discovered expiries, deduplicate, expire after 15s and fail closed', async () => {
  const urls = []; let clock = now, fail = false;
  const get = createNseOptionsClient({ now: () => clock, fetcher: async url => {
    urls.push(url);
    if (url.includes('contract-info')) return response({ expiryDates: ['13-Oct-2026', '27-Oct-2026'] });
    if (url.includes('master-quote')) return response(['RELIANCE', 'ABC&CO']);
    if (fail) return { ok: false, status: 503 };
    return response(fixture());
  } });
  const [a, b] = await Promise.all([get('NIFTY'), get('NIFTY')]);
  assert.equal(a.asOf, b.asOf);
  assert.equal(urls.filter(u => u.includes('option-chain-v3')).length, 1);
  assert.ok(urls.some(u => u.includes('type=Indices&symbol=NIFTY&expiry=13-Oct-2026')));
  assert.ok(a.symbols.includes('ABC&CO'));
  clock += 14000; await get('NIFTY');
  assert.equal(urls.filter(u => u.includes('option-chain-v3')).length, 1);
  clock += 2000; await get('NIFTY');
  assert.equal(urls.filter(u => u.includes('option-chain-v3')).length, 2);
  clock += 16000; fail = true;
  await assert.rejects(get('NIFTY'), /503/);
  await assert.rejects(get('NIFTY', '2026-12-01'), /not listed/);
  await assert.rejects(get('../secrets'), /Invalid/);
});

test('NSE session cookies are initialized once on rejection and retried', async () => {
  let attempts = 0, warmups = 0;
  const get = createNseOptionsClient({ now: () => now, fetcher: async (url, opts) => {
    if (url.endsWith('/option-chain')) { warmups++; return { ok: true, headers: { getSetCookie: () => ['session=test; Path=/'] }, arrayBuffer: async () => new ArrayBuffer(0) }; }
    if (url.includes('contract-info')) {
      if (++attempts === 1) return { ok: false, status: 401 };
      assert.equal(opts.headers.Cookie, 'session=test');
      return response({ expiryDates: ['13-Oct-2026'] });
    }
    if (url.includes('master-quote')) return response([]);
    return response(fixture());
  } });
  assert.equal((await get('NIFTY')).spot, 100);
  assert.equal(warmups, 1);
});

test('stock requests use Equity routing, preserve ampersands and do not require symbol directory', async () => {
  const get = createNseOptionsClient({ now: () => now, fetcher: async url => {
    if (url.includes('contract-info')) { assert.match(url, /ABC%26CO/); return response({ expiryDates: ['13-Oct-2026'] }); }
    if (url.includes('master-quote')) throw Error('directory down');
    assert.match(url, /type=Equity&symbol=ABC%26CO/);
    const input = fixture(); input.records.data.forEach(r => { r.CE.underlying = r.PE.underlying = 'ABC&CO'; });
    return response(input);
  } });
  assert.equal((await get('ABC&CO')).rows.length, 3);
});

test('live options API disables downstream caching and returns NSE timestamps', async t => {
  t.mock.method(globalThis, 'fetch', async url => url.includes('contract-info') ? response({ expiryDates: ['13-Oct-2026'] }) : url.includes('master-quote') ? response([]) : response(fixture()));
  const headers = {}; let status;
  const d = await handler({ method: 'GET', query: { op: 'options', symbol: 'NIFTY' }, headers: {} }, {
    setHeader(k, v) { headers[k] = v; }, status(n) { status = n; return this; }, json(d) { return d; },
  });
  assert.equal(status, 200);
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(d.source, 'NSE option chain');
  assert.equal(d.asOf, '2026-10-07T06:30:00.000Z');
});

test('live futures preserves per-expiry prices, OI and exchange timestamps', async () => {
  const { parseLiveFutures } = await import('../lib/nseOptions.js');
  const d = parseLiveFutures({ timestamp: '07-Oct-2026 12:00:00', data: [
    { underlying: 'NIFTY', expiryDate: '27-Oct-2026', instrumentType: 'FUTIDX', lastPrice: 101, underlyingValue: 100, openInterest: 400, pChange: -0.5, highPrice: 102, lowPrice: 99 },
    { underlying: 'NIFTY', expiryDate: '27-Oct-2026', instrumentType: 'OPTIDX', lastPrice: 5 },
  ] }, now);
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].oi, 400);
  assert.equal(d.rows[0].expiry, '2026-10-27');
  assert.ok(Math.abs(d.rows[0].basis - 1) < 1e-10);
  assert.equal(d.asOf, '2026-10-07T06:30:00.000Z');
  assert.throws(() => parseLiveFutures({ data: [] }), /incomplete/);
  const get = createNseOptionsClient({ fetcher: async () => { throw Error('should not fetch'); } });
  assert.throws(() => get.futures('arbitrary-url'), /Invalid/);
});

test('API suppresses directional signals for stale or invalid exchange timestamps', () => {
  const d = parseLiveOptions(fixture(), 'NIFTY', expiry, [expiry], now + 600000);
  assert.equal(d.freshness, 'stale');
  assert.equal(d.signal.label, 'Unavailable');
  const input = fixture(); input.records.timestamp = '07-Oct-2026 25:99:00';
  assert.throws(() => parseLiveOptions(input, 'NIFTY', expiry), /incomplete/);
});
