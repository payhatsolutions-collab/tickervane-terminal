import test from 'node:test';
import assert from 'node:assert/strict';
import { search, directory, addDirectoryStocks, instruments } from '../src/data.js';
import { buildBrokerOrder } from '../src/brokers.js';
import { parseStockCSV, mergeStockLists, stockSources } from '../src/stockCatalog.js';
import { createStockDirectoryLoader } from '../lib/stockDirectory.js';
import handler from '../api/market.js';

test('recent mainboard and SME listings can be found by symbol and company', () => {
  for (const [symbol, company] of [
    ['TEMPSENS', 'Tempsens'], ['VARMORA', 'Varmora Granito'],
    ['AONESTEELS', 'A-One Steels'], ['ACEVECTOR', 'AceVector'],
    ['MONEYVIEW', 'Moneyview'], ['RKFAL', 'R.K. Fashion Accessories'],
    ['EVENTIONS', 'Eventions'], ['GREENASIA', 'Green Asia Impex'],
  ]) {
    assert.equal(search(symbol)[0]?.symbol, `${symbol}.NS`, symbol);
    assert.ok(search(company).some(s => s.symbol === `${symbol}.NS`), company);
    assert.equal(directory.get(`${symbol}.NS`)?.market, 'India');
  }
});

test('newly covered NSE stocks retain broker handoff eligibility', () => {
  const result = buildBrokerOrder({ symbol: 'TEMPSENS.NS', currency: 'INR', side: 'long', product: 'delivery', entry: 100, quantity: 1 });
  assert.equal(result.order?.tradingsymbol, 'TEMPSENS');
});

test('NSE CSV parser covers mainboard, trade-to-trade and SME series with quoted names', () => {
  const csv = '\uFEFFSYMBOL,NAME_OF_COMPANY,SERIES,DATE_OF_LISTING,\r\n'
    + 'NEWIPO,"New, ""India"" Limited",EQ,12-Oct-26,\r\n'
    + 'SMEIPO,SME Business Ltd.,ST,12-Oct-26,\r\n'
    + 'T2T,Trade to Trade Limited,BE,12-Oct-26,\r\n'
    + 'SZIPO,SZ Business Limited,SZ,12-Oct-26,\r\n'
    + 'NO-RE,Rights Limited,EQ,12-Oct-26,\r\n'
    + 'BAD.NS,Invalid Symbol Limited,EQ,12-Oct-26,\r\n'
    + 'OTHER,Other Series Limited,XX,12-Oct-26,\r\n';
  assert.deepEqual(parseStockCSV(csv).map(s => [s.symbol, s.name]), [
    ['NEWIPO', 'New, "India"'], ['SMEIPO', 'SME Business'], ['T2T', 'Trade to Trade'], ['SZIPO', 'SZ Business'],
  ]);
  assert.throws(() => parseStockCSV('<html>Unavailable</html>'), /Invalid/);
  assert.throws(() => parseStockCSV('SYMBOL,NAME OF COMPANY,SERIES\nTEST,"Broken,EQ'), /Incomplete/);
});

test('merging exchange lists preserves sectors and legacy entries without duplicates', () => {
  assert.deepEqual(mergeStockLists([{ symbol: 'KNOWN', name: 'Known', sector: 'Technology' }], [
    { symbol: 'KNOWN', name: 'Known Limited', sector: 'Others' },
    { symbol: 'NEW', name: 'New', sector: 'Others' },
  ]), [
    { symbol: 'KNOWN', name: 'Known', sector: 'Technology' },
    { symbol: 'NEW', name: 'New', sector: 'Others' },
  ]);
});

test('runtime IPO updates reach actual search, watchlist metadata and broker validation together', () => {
  const symbol = 'NEXTIPO26';
  assert.ok(!directory.has(symbol + '.NS'));
  try {
    assert.equal(addDirectoryStocks([{ symbol, name: 'Next Listing' }, { symbol: '../BAD', name: 'Bad' }]), 1);
    assert.equal(search('Next Listing')[0]?.symbol, symbol + '.NS');
    assert.equal(search(symbol)[0]?.symbol, symbol + '.NS');
    assert.equal(directory.get(symbol + '.NS').market, 'India');
    assert.equal(addDirectoryStocks([{ symbol, name: 'Duplicate' }]), 0);
    assert.equal(addDirectoryStocks(null), 0);
    const order = buildBrokerOrder({ symbol: symbol + '.NS', currency: 'INR', side: 'long', product: 'delivery', entry: 100, quantity: 1 });
    assert.equal(order.order?.tradingsymbol, symbol);
  } finally {
    directory.delete(symbol + '.NS');
    const index = instruments.findIndex(s => s.symbol === symbol + '.NS');
    if (index >= 0) instruments.splice(index, 1);
  }
});

const exchangeCSV = (source, suffix = '') => 'SYMBOL,NAME OF COMPANY,SERIES\n'
  + Array.from({ length: source.minRows }, (_, i) => `${source.id.toUpperCase()}${i}${suffix},Company ${i},${source.id === 'sme' ? 'SM' : 'EQ'}`).join('\n');

test('live directory coalesces concurrent loads, caches six hours and keeps last good data on failures', async () => {
  let time = Date.parse('2026-10-14T00:00:00Z'), calls = 0, fail = false;
  const loader = createStockDirectoryLoader({
    now: () => time,
    fallback: [{ symbol: 'LEGACY', name: 'Legacy', sector: 'Technology' }],
    request: async url => {
      calls++;
      if (fail) throw Error('Exchange offline');
      return { ok: true, text: async () => exchangeCSV(stockSources.find(s => s.url === url)) };
    },
  });
  const [a, b] = await Promise.all([loader(), loader()]);
  assert.equal(calls, 2);
  assert.strictEqual(a, b);
  assert.equal(a.stale, false);
  assert.equal(a.stocks.length, 1101);
  assert.equal(a.stocks.find(s => s.symbol === 'LEGACY').sector, 'Technology');
  time += 6 * 3600e3 - 1;
  assert.strictEqual(await loader(), a);
  assert.equal(calls, 2);
  time += 2;
  fail = true;
  const stale = await loader();
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.stocks, a.stocks);
  assert.equal(stale.fetchedAt, a.fetchedAt);
  assert.equal(calls, 4);
  await loader();
  assert.equal(calls, 4, 'Failed upstream is not retried for every visitor');
  time += 60001;
  fail = false;
  assert.equal((await loader()).stale, false);
  assert.equal(calls, 6);
});

test('incomplete or unavailable NSE directories retain the bundled list with its original timestamp', async () => {
  const fallback = [{ symbol: 'FALLBACK', name: 'Fallback', sector: 'Others' }];
  for (const response of [
    { ok: false },
    { ok: true, text: async () => '<html>Unavailable</html>' },
    { ok: true, text: async () => 'SYMBOL,NAME_OF_COMPANY,SERIES\nSMALL,Small,SM' },
  ]) {
    const loader = createStockDirectoryLoader({ fallback, updatedAt: '2026-10-14T00:00:00Z', request: async () => response });
    const data = await loader();
    assert.strictEqual(data.stocks, fallback);
    assert.equal(data.stale, true);
    assert.equal(data.fetchedAt, '2026-10-14T00:00:00Z');
  }
});

test('directory API returns usable fallback coverage with a short retry cache when NSE fails', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw Error('Exchange offline'); };
  const headers = {};
  let status;
  try {
    const data = await handler({ method: 'GET', query: { op: 'directory' }, headers: {} }, {
      setHeader(key, value) { headers[key] = value; },
      status(code) { status = code; return this; },
      json(data) { return data; },
    });
    assert.equal(status, 200);
    assert.equal(data.stale, true);
    assert.ok(data.stocks.some(s => s.symbol === 'TEMPSENS'));
    assert.ok(data.stocks.some(s => s.symbol === 'RKFAL'));
    assert.equal(headers['Cache-Control'], 'public, max-age=0, s-maxage=60');
  } finally { globalThis.fetch = original; }
});
