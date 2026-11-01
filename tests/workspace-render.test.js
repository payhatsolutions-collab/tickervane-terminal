import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Exercise real JSX without a browser or live market requests.
const require = createRequire(import.meta.url);
const temp = await mkdtemp(join(tmpdir(), 'workspace-render-'));
after(() => rm(temp, { recursive: true, force: true }));
const outfile = join(temp, 'components.cjs');
await build({
  stdin: {
    contents: `export { CandlestickPreview } from './src/ScreenChart.jsx';
      export { default as SwingDesk } from './src/SwingDesk.jsx';
      export { default as MarketOverview } from './src/MarketOverview.jsx';
      export { default as Screener } from './src/Screener.jsx';
      export { load, clearCache } from './src/hooks.js';
      export { default as CompanyBrief } from './src/CompanyBrief.jsx';
      export { default as BreakoutInsights } from './src/BreakoutInsights.jsx';
      export { default as PersonalAlerts } from './src/PersonalAlerts.jsx';
      export { default as AdvancedAnalytics } from './src/AdvancedAnalytics.jsx';`,
    resolveDir: process.cwd(), loader: 'jsx',
  }, outfile, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
  loader: { '.css': 'empty' },
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: require.resolve(args.path), external: true }));
  } }],
});
const { CandlestickPreview, SwingDesk, MarketOverview, Screener, load, clearCache, BreakoutInsights, PersonalAlerts, AdvancedAnalytics, CompanyBrief } = require(outfile);
const noop = () => {};

test('company brief renders business, dated financials, valuation and growth narrative with source links', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ peTrailing: 30, marketCap: 5000e7, fetchedAt: '2026-11-01T12:00:00Z',
    company: { businessSummary: 'Builds software for banks.', website: 'https://example.com', currency: 'INR', revenue: 1000e7, netIncome: 100e7, netMargin: 0.1, operatingMargin: 0.2, roe: 0.15,
      revenueGrowth: 0.1, earningsGrowth: 0.15, growthPeriod: 'TTM year over year', basis: 'Consolidated', period: 'TTM', end: '2026-09-30', source: 'Screener.in', url: 'https://www.screener.in/company/TCS/consolidated/', history: [] },
  }) }));
  clearCache(); await load('/api/market?op=fundamentals&symbol=TCS.NS');
  const html = renderToStaticMarkup(React.createElement(CompanyBrief, { symbol: 'TCS.NS', industry: 'Information Technology', refresh: 0 }));
  for (const text of ['Builds software for banks.', 'Net income', 'ROE', '15.0%', '30.0×', 'Growth prospects', 'Valuation &amp; profitability', '2026-09-30', 'client technology budgets']) assert.ok(html.includes(text), text);
  assert.match(html, /Financial statements &amp; company disclosures/);
  assert.doesNotMatch(html, /NaN|undefined/);
  clearCache();
});

test('breakout research renders stock-specific evidence, risks and actions from real component data', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({
    date: '2026-10-30', source: 'Test session', rows: [{ symbol: 'TCS', name: 'Tata Consultancy Services', industry: 'IT',
      breakout20: true, volRatio: 2, rsi: 75, rs3m: 12, price: 3000, above200: true }],
  }) }));
  clearCache(); await load('/api/market?op=screen');
  const html = renderToStaticMarkup(React.createElement(BreakoutInsights, {
    symbol: 'TCS.NS', refresh: 0, onRefresh: noop, onSelect: noop, onOpen: noop, onAlert: noop, watch: [], toggleWatch: noop,
  }));
  assert.match(html, /Tata Consultancy Services/);
  assert.match(html, /Confirmed breakout/);
  assert.match(html, /2\.00×/);
  assert.match(html, /outperformed/);
  assert.match(html, /What could weaken the setup/);
  assert.match(html, /Set price alert/);
  assert.match(html, /Add to watchlist/);
  assert.doesNotMatch(html, /NaN|undefined/);
  clearCache();
});

test('personal alerts render scope, repetition, pause controls and durable match history', () => {
  const html = renderToStaticMarkup(React.createElement(PersonalAlerts, {
    rules: [{ id: 'r1', name: 'My signal', scope: 'watchlist', metric: 'breakout20', threshold: 1, operator: 'min', frequency: 'daily', enabled: true }],
    setRules: noop, setEvents: noop, events: [{ id: 'e1', name: 'My signal', session: '2026-10-30', at: '2026-10-30T12:00:00Z', symbols: ['TCS.NS'] }],
    watch: ['TCS.NS'], symbol: 'TCS.NS', onOpen: noop,
  }));
  assert.match(html, /Save personalized alert/);
  assert.match(html, /Once per matching session/);
  assert.match(html, /Pause/);
  assert.match(html, /Session 2026-10-30/);
  assert.match(html, /no closed-app delivery/);
});

test('analytics renders missing data as unavailable rather than fabricated metrics', () => {
  clearCache();
  const html = renderToStaticMarkup(React.createElement(AdvancedAnalytics, {
    symbol: 'TCS.NS', refresh: 0, onRefresh: noop, onSelect: noop, watch: [],
  }));
  assert.match(html, /Loading market analytics/);
  assert.match(html, /Loading adjusted daily history/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test('market snapshot distinguishes unavailable quotes from zero and uses only supplied prices', () => {
  const html = renderToStaticMarkup(React.createElement(MarketOverview, {
    quotes: { '^NSEI': { price: 25000, change: -1.25, marketTime: 1793072700, spark: [100, 102, 101] }, '^NSEBANK': { price: 0, change: 0 } },
    loading: false, onOpen: noop, onPage: noop, onSearch: noop,
  }));
  assert.match(html, /25,000\.00/);
  assert.match(html, /-1\.25%/);
  assert.match(html, /\+0\.00%/);
  assert.equal((html.match(/Quote unavailable/g) || []).length, 2);
  assert.equal((html.match(/<polyline/g) || []).length, 1);
  assert.match(html, /IST · may be delayed/);
  assert.match(html, /Open Nifty 50 chart/);
});

test('market snapshot has a usable loading state without inventing changes or trends', () => {
  const html = renderToStaticMarkup(React.createElement(MarketOverview, {
    quotes: {}, loading: true, onOpen: noop, onPage: noop, onSearch: noop,
  }));
  assert.equal((html.match(/Updating…/g) || []).length, 4);
  assert.doesNotMatch(html, /<polyline|NaN|undefined|\+0\.00%/);
});
const bars = Array.from({ length: 260 }, (_, i) => ({
  time: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10),
  open: 100 + i, high: 105 + i, low: 98 + i, close: 102 + i,
}));

test('closed candlestick previews render only thumbnail candles, not enlarged charts', () => {
  const html = renderToStaticMarkup(React.createElement(CandlestickPreview, {
    range: '3M', symbol: 'TCS', feed: { data: { bars, currency: 'INR' }, loading: false }, onRetry: noop,
  }));
  assert.equal((html.match(/<rect /g) || []).length, 64);
  assert.match(html, /Enlarge TCS candlestick chart/);
  assert.match(html, /<dialog[^>]*><\/dialog>/);
  assert.doesNotMatch(html, /viewBox="0 0 640 280"/);
});

test('overview combines saved quotes and breadth in one watchlist panel', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ rows: [] }) }));
  clearCache();
  await load('/api/market?op=screen');
  const oldWindow = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  try {
    const html = renderToStaticMarkup(React.createElement(SwingDesk, {
      refresh: 0, onRefresh: noop, onOpen: noop, onPage: noop, onSearch: noop,
      watch: ['TCS.NS'], toggleWatch: noop, journal: [], alerts: [],
      quotes: { 'TCS.NS': { price: 100, change: 2, currency: 'INR', marketTime: 1800000000 } },
    }));
    assert.equal((html.match(/<h2>Your watchlist<\/h2>/g) || []).length, 1);
    assert.match(html, /1 rising/);
    assert.match(html, /TCS/);
    assert.doesNotMatch(html, /overview-intro|Your next research session/);
  } finally { globalThis.window = oldWindow; clearCache(); }
});

test('screener defaults to data rows without mounting chart previews and retains every preset', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({
    rows: [{ symbol: 'TCS', name: 'Tata Consultancy Services', industry: 'IT', score: 90,
      price: 100, change: 2, above200: true, rsi: 60 }], coverage: { symbols: 1, withHistory: 1 },
  }) }));
  clearCache();
  await load('/api/market?op=screen');
  const html = renderToStaticMarkup(React.createElement(Screener, {
    view: { active: 'custom', custom: { id: 'custom', name: 'All', when: [] } },
    setView: noop, onOpen: noop, watch: [], toggleWatch: noop, refresh: 0,
    onRefresh: noop, saved: [], setSaved: noop, pushOn: false, notify: noop, goAlerts: noop,
  }));
  assert.match(html, /data-quote-symbol="TCS.NS"/);
  assert.match(html, /Show charts/);
  assert.doesNotMatch(html, /screen-chart-slot|Loading candles/);
  assert.match(html, /aria-label="Screen preset"/);
  assert.match(html, /saved-screens-drawer/);
  clearCache();
});

test('setup watch displays the latest quote instead of the screening session close', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({
    rows: [{ symbol: 'TCS', name: 'Tata Consultancy Services', price: 100, breakout20: true, volRatio: 2, turnoverCr: 10 }], date: '2026-10-29',
  }) }));
  clearCache();
  await load('/api/market?op=screen');
  const oldWindow = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  const render = quotes => renderToStaticMarkup(React.createElement(SwingDesk, {
    refresh: 0, onRefresh: noop, onOpen: noop, onPage: noop, onSearch: noop,
    watch: [], toggleWatch: noop, journal: [], alerts: [], quotes,
  }));
  try {
    const html = render({ 'TCS.NS': { price: 123.45, change: 2.5, currency: 'INR', marketTime: 1793268000 } });
    assert.match(html, /LTP/);
    assert.match(html, /123\.45/);
    assert.doesNotMatch(html, /Last close|₹100\.00/);
    const missing = render({});
    assert.match(missing, /Awaiting quote/);
    assert.doesNotMatch(missing, /₹100\.00/);
  } finally { globalThis.window = oldWindow; clearCache(); }
});
