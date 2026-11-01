import test from 'node:test';
import assert from 'node:assert/strict';
import { overviewMetrics } from '../src/overviewMetrics.js';
import { commandGroups } from '../src/commandSearch.js';

test('breadth separates missing prices from unchanged stocks and uses known trend coverage', () => {
  const result = overviewMetrics([
    { change: 2, above50: true, above200: false },
    { change: -1, above50: false, above200: true },
    { change: 0, above50: null, above200: true },
    { change: null, above50: true },
    { change: NaN, above50: 'true', above200: null },
  ]);
  assert.deepEqual([result.total, result.known, result.rising, result.falling, result.flat], [5, 3, 1, 1, 1]);
  assert.ok(Math.abs(result.risingPercent - 100 / 3) < 1e-10);
  assert.deepEqual(result.medium, { known: 3, above: 2, percent: 2 / 3 * 100 });
  assert.equal(result.long.known, 3);
});

test('unavailable breadth stays unknown while an entirely falling session shows zero advancing', () => {
  const missing = overviewMetrics([{ change: null }]);
  assert.equal(missing.risingPercent, null);
  assert.equal(missing.long.percent, null);
  const down = overviewMetrics([{ change: -1, above200: false }]);
  assert.equal(down.risingPercent, 0);
  assert.equal(down.long.percent, 0);
});

const stocks = [{ symbol: 'TCS.NS', name: 'Tata Consultancy Services', market: 'India' }, { symbol: 'AAPL', name: 'Apple', market: 'US' }];
const catalog = new Map(stocks.map(stock => [stock.symbol, stock]));
const groups = (query, extra = {}) => commandGroups({ query, instruments: [], catalog, ...extra });

test('workspace aliases make keyboard search useful for tasks and product names', () => {
  assert.equal(groups('  backup ')[0].items[0].page, 'Portfolio');
  assert.equal(groups('options')[0].items[0].page, 'FnO');
  assert.equal(groups('nifty edge')[0].items[0].page, 'FnO');
  assert.equal(groups('alerts')[0].items[0].page, 'Alerts');
  assert.deepEqual(groups('not a real result'), []);
});

test('contextual instrument search never navigates away to a workspace', () => {
  assert.deepEqual(groups('portfolio', { includePages: false }), []);
  const result = groups('tcs', { includePages: false, instruments: [stocks[0]] });
  assert.equal(result[0].items[0].symbol, 'TCS.NS');
  assert.equal(result[0].items[0].kind, 'instrument');
});

test('recent research is deduplicated, excludes missing symbols and yields stable unique result IDs', () => {
  const result = groups('', { recent: ['MISSING', 'TCS.NS', 'TCS.NS'], instruments: stocks });
  assert.equal(result[0].label, 'Recently viewed');
  assert.equal(result[0].items.length, 1);
  const entries = result.flatMap(group => group.items);
  assert.equal(entries.filter(entry => entry.symbol === 'TCS.NS').length, 1);
  assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length);
  assert.equal(result.at(-1).items[0].symbol, 'AAPL');
});
