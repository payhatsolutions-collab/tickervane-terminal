import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { buildOverview } from '../lib/overview.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { PRO_PAGES } from '../lib/proPlan.js';
import { PRO_WORKSPACE_COPY } from '../lib/proCopy.js';
import { parseBackup } from '../src/backup.js';

// Exercise real JSX without a browser or live market requests.
const require = createRequire(import.meta.url);
const temp = await mkdtemp(join(tmpdir(), 'workspace-render-'));
after(() => rm(temp, { recursive: true, force: true }));
const outfile = join(temp, 'components.cjs');
await build({
  stdin: {
    contents: `export { CandlestickPreview } from './src/ScreenChart.jsx';
      export { TradeJournal } from './src/TradeDesk.jsx';
      export { BreakoutOffer } from './src/SetupOffer.jsx';
      export { default as SwingDesk } from './src/SwingDesk.jsx';
      export { default as MarketOverview } from './src/MarketOverview.jsx';
      export { default as Screener } from './src/Screener.jsx';
      export { load, clearCache } from './src/hooks.js';
      export { default as CompanyBrief } from './src/CompanyBrief.jsx';
      export { default as BreakoutInsights } from './src/BreakoutInsights.jsx';
      export { default as PersonalAlerts } from './src/PersonalAlerts.jsx';
      export { default as ProGate } from './src/ProGate.jsx';
      export { default as ProExample } from './src/ProExample.jsx';
      export { default as ForecastAnswer } from './src/ForecastAnswer.jsx';
      export { default as FnO } from './src/FnO.jsx';
      export { default as Flows } from './src/Flows.jsx';
      export { ThemeProvider } from './src/theme.jsx';
      export { default as AdvancedAnalytics } from './src/AdvancedAnalytics.jsx';`,
    resolveDir: process.cwd(), loader: 'jsx',
  }, outfile, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
  loader: { '.css': 'empty' }, define: { 'import.meta.env.VITE_KITE_PUBLISHER_KEY': '""' },
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: require.resolve(args.path), external: true }));
  } }],
});
const { CandlestickPreview, SwingDesk, MarketOverview, Screener, load, clearCache, BreakoutInsights, PersonalAlerts, AdvancedAnalytics, CompanyBrief, ProGate, ProExample, ForecastAnswer, FnO, Flows, ThemeProvider } = require(outfile);
const noop = () => {};

test('journal restores the trade and valid text when an imported annotation is malformed', () => {
  const { TradeJournal } = require(outfile);
  const trade = { id: '1', symbol: 'TCS.NS', currency: 'INR', status: 'closed', side: 'long',
    entry: 100, stop: 90, target: 120, quantity: 2, plannedRisk: 20, exit: 115,
    createdAt: '2026-11-01', closedAt: '2026-11-02', notes: 'Entry note', review: 'Exit review', setup: 'Pullback' };
  for (const field of ['notes', 'review', 'setup']) {
    const { journal } = parseBackup({ watch: [], positions: [], alerts: [], journal: [{ ...trade, [field]: {} }] });
    const html = renderToStaticMarkup(React.createElement(TradeJournal, { entries: journal }));
    assert.match(html, /TCS/);
    for (const key of ['notes', 'review', 'setup'].filter(key => key !== field)) assert.ok(html.includes(trade[key]));
    assert.doesNotMatch(html, /\[object Object\]/);
  }
});

test('every Pro workspace renders its pitch, illustrative preview and complete plan', () => {
  for (const page of PRO_PAGES) {
    const html = renderToStaticMarkup(React.createElement(ThemeProvider, null, React.createElement(ProGate, {
      page, access: { signedIn: false },
    })));
    assert.ok(html.includes(PRO_WORKSPACE_COPY[page].question), page);
    assert.match(html, /SAMPLE · ILLUSTRATIVE DATA/);
    assert.match(html, /All 5 Pro workspaces/);
    // Markets and Fundamentals are free, so the paywall does not list them as Pro.
    const included = html.slice(html.indexOf('What you can check with Pro'));
    assert.match(included, /Futures &amp; options/);
    assert.doesNotMatch(included, /Fundamentals|Markets/);
    // The paywall's only way back is the workspace's free example, offered when there is one to show.
    assert.doesNotMatch(html, /Continue with free research|See the free live example/);
    const withExample = renderToStaticMarkup(React.createElement(ThemeProvider, null, React.createElement(ProGate, {
      page, access: { signedIn: false }, onExample: noop,
    })));
    assert.match(withExample, /<button[^>]*pro-gate-example[^>]*>.*See the free live example<\/button>/);
    assert.doesNotMatch(html, /NaN|undefined/);
  }
});

test('Pro workspaces support signed-in checkout and renewal', () => {
  for (const page of ['Breakouts', 'FnO']) {
    const access = { signedIn: true };
    const checkout = renderToStaticMarkup(React.createElement(ProGate, { page, access }));
    assert.match(checkout, /Step 2 of 2/);
    assert.match(checkout, /Submit payment reference/);
    const renewal = renderToStaticMarkup(React.createElement(ProGate, { page, access, renew: true }));
    assert.match(renewal, /Add 30 days to keep using all 5 Pro workspaces/);
    assert.doesNotMatch(renewal, /SAMPLE · ILLUSTRATIVE DATA/);
    // A subscriber renewing is not sent back to an example.
    assert.doesNotMatch(renderToStaticMarkup(React.createElement(ProGate, { page, access, renew: true, onExample: noop })), /See the free live example/);
  }
});

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

test('analytics renders market charts, matched performance, drawdown and sortable industry returns', async t => {
  t.mock.method(globalThis, 'fetch', async url => ({ ok: true, json: async () => url.includes('op=screen') ? {
    date: '2026-10-30', rows: [
      { symbol: 'TCS', industry: 'IT', above200: true, r3m: 12, rs3m: 4, volRatio: 1.2 },
      { symbol: 'ITC', industry: 'Consumer', above200: false, r3m: -3 },
      { symbol: 'INFY', industry: 'IT', above200: null, r3m: null },
    ],
  } : { adjusted: true, timezone: 'Asia/Kolkata', bars: [100, 110, 90].map((close, i) => ({ time: `2026-10-0${i + 1}`, close })) } }));
  clearCache();
  await Promise.all([
    load('/api/market?op=screen'),
    load('/api/market?op=chart&symbol=TCS.NS&range=1y&adjusted=1'),
    load('/api/market?op=chart&symbol=%5ENSEI&range=1y&adjusted=1'),
  ]);
  const html = renderToStaticMarkup(React.createElement(AdvancedAnalytics, {
    symbol: 'TCS.NS', refresh: 0, onRefresh: noop, onSelect: noop, watch: [],
  }));
  for (const label of ['How broad is the market?', 'Industry momentum', 'Cumulative return chart', 'Historical drawdown chart', 'matched dates', '1 stocks unavailable', 'Coverage &amp; methodology']) assert.ok(html.includes(label), label);
  assert.match(html, /aria-sort="none"[^>]*><button>Median 3M return/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
  clearCache();
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

test('home leads with setup watch and leaves the watchlist and alerts to their own pages', async t => {
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
    assert.equal((html.match(/<h1>Setup watch<\/h1>/g) || []).length, 1);
    assert.doesNotMatch(html, /Your watchlist|Price alerts|overview-tabs/);
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
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => buildOverview({
    rows: [{ symbol: 'TCS', name: 'Tata Consultancy Services', price: 100, breakout20: true, volRatio: 2, turnoverCr: 10, prior20High: 98, meanTrueRange14: 3 }], date: '2026-10-29',
  }) }));
  clearCache();
  await load('/api/market?op=overview');
  const oldWindow = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  const render = quotes => renderToStaticMarkup(React.createElement(SwingDesk, {
    refresh: 0, onRefresh: noop, onOpen: noop, onPage: noop, onSearch: noop,
    watch: [], toggleWatch: noop, journal: [], alerts: [], quotes,
    access: { signedIn: true, trialEligible: false },
  }));
  try {
    const html = render({ 'TCS.NS': { price: 123.45, change: 2.5, currency: 'INR', marketTime: 1793268000 } });
    assert.match(html, /LTP/);
    assert.match(html, /123\.45/);
    assert.match(html, /At ₹123\.45, the price is ₹19\.45 above the target and the stop is ₹28\.45 away\./);
    const atPrice = price => render({ 'TCS.NS': { price } });
    assert.match(atPrice(101), /At ₹101, the target is ₹3 away and the stop is ₹6 away\./);
    assert.match(atPrice(104), /the price is at the target and the stop is ₹9 away/);
    assert.match(atPrice(95), /the price is at the stop and the target is ₹9 away/);
    assert.match(atPrice(94.75), /the price is ₹0\.25 below the stop and the target is ₹9\.25 away/);
    assert.doesNotMatch(html, /Get Pro|setup-offer/);
    assert.match(html, /Session 2026-10-29 · 1 stocks/);
    assert.doesNotMatch(html, /Last close|₹100\.00/);
    const missing = render({});
    assert.match(missing, /Awaiting quote/);
    assert.doesNotMatch(missing, /setup-distance/);
    for (const page of [html, missing]) {
      assert.match(page, /Pivot<\/dt><dd>₹98\.00/);
      assert.match(page, /Target<\/dt><dd>₹104\.00/);
      assert.match(page, /SL<\/abbr><\/dt><dd>₹95\.00/);
    }
    assert.doesNotMatch(missing, /₹100\.00/);
  } finally { globalThis.window = oldWindow; clearCache(); }
});


test('eligible readers see a 30-minute free trial without a payment form', () => {
  const html = renderToStaticMarkup(React.createElement(ProGate, {
    page: 'FnO', access: { signedIn: true, trialEligible: true, appTrialEligible: true },
  }));
  assert.match(html, /Start 30-minute free trial/);
  assert.match(html, /for 30 minutes/);
  assert.match(html, /No payment details or automatic charge/);
  // The app's longer trial is a surprise after installing: never advertised to browser readers.
  assert.doesNotMatch(html, /<form|3.day|72.hour|installing|href="\/install"/);
  const expired = renderToStaticMarkup(React.createElement(ProGate, {
    page: 'FnO', access: { signedIn: true, trialEligible: false, appTrialEligible: true },
  }));
  assert.match(expired, /Submit payment reference/);
  assert.doesNotMatch(expired, /<button[^>]*>Start 30-minute free trial/);
  assert.doesNotMatch(expired, /3.day|installing|href="\/install"/);
  const signedOut = renderToStaticMarkup(React.createElement(ThemeProvider, null, React.createElement(ProGate, { page: 'FnO', access: { signedIn: false } })));
  assert.match(signedOut, /for 30 minutes/);
  assert.doesNotMatch(signedOut, /3.day|installing|href="\/install"/);
});

test('readers with the app are offered the three-day trial, including after a used browser trial', () => {
  const oldWindow = globalThis.window;
  globalThis.window = { alphaNovaInstall: { installed: true }, localStorage: { setItem() {}, getItem: () => null } };
  try {
    for (const access of [{ signedIn: false }, { signedIn: true, trialEligible: true, appTrialEligible: true }, { signedIn: true, trialEligible: false, appTrialEligible: true }]) {
      const html = renderToStaticMarkup(React.createElement(ThemeProvider, null, React.createElement(ProGate, { page: 'FnO', access })));
      assert.match(html, /<strong>Free<\/strong><span>for 3 days<\/span>/);
      assert.doesNotMatch(html, /30.minute|<form/);
      assert.match(html, /A thank-you for installing the app/);
      if (access.signedIn) assert.match(html, /<button[^>]*>Start 3-day free trial<\/button>/);
      else assert.match(html, /then start your 3 days/);
    }
    const used = renderToStaticMarkup(React.createElement(ProGate, { page: 'FnO', access: { signedIn: true, trialEligible: false, appTrialEligible: false } }));
    assert.match(used, /Submit payment reference/);
    assert.doesNotMatch(used, /for 3 days|Start 3-day/);
  } finally { globalThis.window = oldWindow; }
});

test('a locked workspace names its free example and carries the offer the reader can still claim', () => {
  const render = props => renderToStaticMarkup(React.createElement(ProExample, { onUnlock: noop, ...props }));
  const forecast = render({ page: 'Forecast', access: { signedIn: false }, example: 'RELIANCE.NS' });
  assert.match(forecast, /FREE EXAMPLE/);
  assert.match(forecast, /<strong>RELIANCE, with real data\.<\/strong> Pro runs the forecast for any other stock/);
  assert.match(forecast, /<button[^>]*>Try Pro free for 30 min/);
  // A reader who came for another stock is told that stock needs Pro, and what they are looking at instead.
  const asked = render({ page: 'Analytics', access: { signedIn: true, trialEligible: false }, example: 'RELIANCE.NS', requested: 'TCS.NS' });
  assert.match(asked, /TCS NEEDS PRO/);
  assert.match(asked, /<strong>This is the free example, RELIANCE\.<\/strong> Pro runs this risk check for TCS and any other stock\./);
  assert.match(asked, /<button[^>]*>Get Pro · ₹300/);
  assert.match(render({ page: 'Breakouts', access: { signedIn: false }, example: 'ITC.NS' }), /<strong>ITC, the latest session’s top breakout by turnover\.<\/strong>/);
  assert.match(render({ page: 'FnO', access: { signedIn: false } }), /<strong>Nifty option chain, nearest expiry\.<\/strong>/);
  assert.match(render({ page: 'Flows', access: { signedIn: false } }), /<strong>FII\/DII cash and the 5 largest deals\.<\/strong>/);
  // No button until the account is known, and none for an account that support has paused.
  for (const access of [{ loading: true, signedIn: false }, { signedIn: true, paused: true }]) assert.doesNotMatch(render({ page: 'FnO', access }), /<button/);
  for (const page of PRO_PAGES) assert.doesNotMatch(render({ page, access: { signedIn: false }, example: 'ITC.NS', requested: 'TCS.NS' }), /NaN|undefined|3.day|installing/);
});

test('without Pro, Futures & options shows the Nifty chain at its nearest expiry and locks the rest', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({
    symbol: 'NIFTY', expiry: '2026-11-17', expiries: ['2026-11-17', '2026-11-24'], symbols: ['NIFTY', 'BANKNIFTY'], asOf: new Date().toISOString(),
    exchangeTimestamp: '17-Nov-2026 15:30:00', spot: 25010, atm: 25000, daysToExpiry: 0, pcr: 1.2, maxPain: 25000,
    rows: [{ strike: 25000, CE: { oi: 10, chg: 1, close: 50, vol: 5 }, PE: { oi: 12, chg: 2, close: 45, vol: 6 } }],
    signal: { label: 'Range', reasons: ['Balanced positioning.'], support: 25000, resistance: 25000 },
  }) }));
  clearCache(); await load('/api/market?op=options&symbol=NIFTY');
  const props = { symbol: 'TCS.NS', onOpen: noop, refresh: 0, onRefresh: noop, watch: [] };
  const html = renderToStaticMarkup(React.createElement(FnO, { ...props, preview: true, onLocked: noop }));
  assert.match(html, /NSE option chain/);
  assert.match(html, /<strong>25,000<\/strong>/);
  for (const locked of ['BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'Export']) assert.match(html, new RegExp(`${locked}<b class="pro-pill"`), locked);
  assert.doesNotMatch(html, /<button[^>]*>NIFTY<b class="pro-pill"/);
  assert.match(html, /<option value="2026-11-17" selected="">17 Nov 2026<\/option><option value="2026-11-24">24 Nov 2026 · Pro<\/option>/);
  assert.match(html, /MORE IN ALPHA NOVA PRO/);
  assert.doesNotMatch(html, /<iframe|<h2>NSE futures contracts<\/h2>|<h2>Futures OI build-up · end of day<\/h2>/);
  const full = renderToStaticMarkup(React.createElement(FnO, props));
  assert.match(full, /NSE option chain/);
  assert.match(full, /NSE futures contracts/);
  assert.match(full, /Futures OI build-up/);
  assert.doesNotMatch(html + full, /NIFTY EDGE|nifty-edge|<iframe/);
  assert.doesNotMatch(full, /pro-pill|MORE IN ALPHA NOVA PRO/);
  clearCache();
});

test('without Pro, Institutional flows shows cash flows and only the five largest deals', async t => {
  const deals = Array.from({ length: 8 }, (_, i) => ({ date: '2026-11-16', kind: 'Bulk', symbol: `DEAL${i}`, name: `Stock ${i}`, client: `Client ${i}`, side: i % 2 ? 'SELL' : 'BUY', qty: 1000, price: 100, valueCr: (i + 1) * 10 }));
  const side = { futIdxLongPct: 40, futIdx: 1, idxCall: 2, idxPut: 3, futStk: 4 };
  t.mock.method(globalThis, 'fetch', async url => ({ ok: true, json: async () => url.includes('op=deals') ? { date: '2026-11-16', rows: deals } : {
    cash: { date: '2026-11-16', fii: { net: 100, buy: 500, sell: 400 }, dii: { net: -50, buy: 300, sell: 350 } },
    participants: { date: '2026-11-16', sourceUrl: 'https://example.com', rows: { FII: side, DII: side, Pro: side, Client: side } },
  } }));
  clearCache(); await Promise.all([load('/api/market?op=flows'), load('/api/market?op=deals')]);
  const props = { onOpen: noop, refresh: 0, onRefresh: noop, watch: ['DEAL0.NS'], toggleWatch: noop };
  const html = renderToStaticMarkup(React.createElement(Flows, { ...props, preview: true, onLocked: noop }));
  assert.match(html, /FII \/ FPI net/);
  assert.match(html, /\+₹100 Cr/);
  assert.deepEqual((html.match(/<strong>DEAL\d<\/strong>/g) || []).map(tag => tag.slice(8, 13)), ['DEAL7', 'DEAL6', 'DEAL5', 'DEAL4', 'DEAL3']);
  assert.match(html, /The 5 largest deals by value, of 8 reported for this session\./);
  assert.match(html, /See all 8 deals<b class="pro-pill"/);
  assert.match(html, /Export<b class="pro-pill"/);
  assert.match(html, /MORE IN ALPHA NOVA PRO/);
  assert.doesNotMatch(html, /<table class="positioning"|Filter symbol or client|Your watchlist:|NaN|undefined/);
  // With Pro: participant positioning, every deal, the filters and the reader's watchlist matches.
  const full = renderToStaticMarkup(React.createElement(Flows, props));
  assert.match(full, /<table class="positioning"/);
  assert.equal((full.match(/<strong>DEAL\d<\/strong>/g) || []).length, 8);
  assert.match(full, /Filter symbol or client/);
  assert.match(full, /Your watchlist:/);
  assert.doesNotMatch(full, /pro-pill|MORE IN ALPHA NOVA PRO|largest deals by value/);
  clearCache();
});

test('without Pro, Breakout insights opens the top breakout and marks every other company as Pro', async t => {
  const row = (symbol, turnoverCr) => ({ symbol, name: `${symbol} Limited`, industry: 'IT', breakout20: true, volRatio: 2, rsi: 60, rs3m: 5, price: 100, change: 1, above200: true, turnoverCr });
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ date: '2026-11-16', source: 'Test session', rows: [row('SMALL', 20), row('BIG', 900), row('MID', 300)] }) }));
  clearCache(); await load('/api/market?op=screen');
  const props = { refresh: 0, onRefresh: noop, onSelect: noop, onOpen: noop, onAlert: noop, watch: [], toggleWatch: noop };
  const html = renderToStaticMarkup(React.createElement(BreakoutInsights, { ...props, symbol: 'BIG.NS', preview: true }));
  // The list follows the home page's order, so the free example comes first.
  assert.deepEqual((html.match(/<span><strong>[A-Z]+/g) || []).map(tag => tag.slice(14)), ['BIG', 'MID', 'SMALL']);
  assert.match(html, /<strong>BIG<\/strong>/);
  assert.match(html, /<strong>MID<b class="pro-pill"/);
  assert.match(html, /<option value="MID\.NS">MID · MID Limited · Pro<\/option>/);
  assert.match(html, /<option value="BIG\.NS" selected="">BIG · BIG Limited<\/option>/);
  assert.match(html, /COMPANY RESEARCH · BIG/);
  assert.match(html, /What could weaken the setup/);
  // With Pro the list keeps the session's own order and nothing is marked.
  const full = renderToStaticMarkup(React.createElement(BreakoutInsights, { ...props, symbol: 'MID.NS' }));
  assert.deepEqual((full.match(/<span><strong>[A-Z]+/g) || []).map(tag => tag.slice(14)), ['SMALL', 'BIG', 'MID']);
  assert.doesNotMatch(full, /pro-pill|· Pro</);
  clearCache();
});

test('without Pro, Advanced analytics marks its stock picker as Pro', () => {
  clearCache();
  const props = { symbol: 'RELIANCE.NS', refresh: 0, onRefresh: noop, onSelect: noop, watch: [] };
  assert.match(renderToStaticMarkup(React.createElement(AdvancedAnalytics, { ...props, preview: true })), /<label>Stock<b class="pro-pill"/);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(AdvancedAnalytics, props)), /pro-pill/);
});

test('Forecast leads with the likely range, names an unchanged centre plainly and labels the trend as a what-if', () => {
  const point = { date: '2026-11-30', close: 1339.7, lower80: 1261.59, upper80: 1422.65 };
  const evaluation = { count: 40, selected: { coverage80: 77.5 } };
  const whatIf = { close: 1401.86, change: 4.64, sessions: 30, capped: false };
  const render = props => renderToStaticMarkup(React.createElement(ForecastAnswer, { name: 'Reliance Industries', point, lastClose: 1339.7, currency: 'INR', whatIf, evaluation, ...props }));
  const html = render();
  assert.match(html, /Reliance Industries · 2026-11-30 · in 10 sessions/);
  // The headline is the range, in whole rupees for a four-figure price, readable aloud as "to".
  assert.match(html, /<span>1,262<\/span> <span aria-hidden="true">–<\/span><span class="fore-hidden"> to <\/span> <span>1,423<\/span> <small>INR<\/small>/);
  assert.match(html, /Likely range · 8 in 10 outcomes/);
  assert.match(html, /Centre 1,339\.70, the last close\. No clear direction\./);
  assert.match(html, /If the last 30 sessions’ trend continued: <strong>1,401\.86<\/strong> <span class="positive">\+4\.6%<\/span>/);
  assert.match(html, /a what-if, not a prediction: in testing, extending the trend was less accurate than assuming no change/);
  assert.match(html, /In 40 past forecasts for this ticker, the price finished inside the range 31 times\./);
  // The old card repeated the last close as a projection of +0.00%.
  assert.doesNotMatch(html, /trend projection|\+0\.00%|NaN|undefined/);

  // A model that does lean says by how much, against the last close.
  const leaning = render({ point: { ...point, close: 1350 }, whatIf: { ...whatIf, close: 1290.1, change: -3.7 } });
  assert.match(leaning, /Centre 1,350\.00, <span class="positive">\+0\.77%<\/span> from the last close of 1,339\.70\./);
  assert.match(leaning, /<strong>1,290\.10<\/strong> <span class="negative">-3\.7%<\/span>/);
  assert.doesNotMatch(leaning, /No clear direction/);

  // No trend, no history to test on, or no scenario at all: say so or stay silent, never invent a figure.
  const quiet = render({ whatIf: { close: 1339.7, change: 0, sessions: 30, capped: false }, evaluation: { count: 0, selected: null } });
  assert.match(quiet, /The last 30 sessions show no trend to extend\./);
  assert.doesNotMatch(quiet, /what-if|past forecasts|NaN|undefined/);
  assert.match(quiet, /Experimental\./);
  assert.doesNotMatch(render({ whatIf: null }), /trend continued|no trend to extend/);
  assert.match(render({ whatIf: { ...whatIf, capped: true } }), /\(capped at 1% a session\)/);

  // Small prices keep their decimals; sub-rupee prices get four.
  assert.match(render({ point: { ...point, close: 285, lower80: 269.04, upper80: 301.9 }, lastClose: 285 }), /<span>269\.04<\/span>.*<span>301\.90<\/span>/);
  assert.match(render({ point: { ...point, close: 0.035, lower80: 0.0312, upper80: 0.0398 }, lastClose: 0.035, currency: 'USD', whatIf: null }), /<span>0\.0312<\/span>.*<span>0\.0398<\/span> <small>USD<\/small>/);
});

test('the paywall Forecast sample describes a range with a what-if, not a projected gain', () => {
  const html = renderToStaticMarkup(React.createElement(ThemeProvider, null, React.createElement(ProGate, { page: 'Forecast', access: { signedIn: false } })));
  assert.match(html, /How far could the price move in 10 sessions\?/);
  assert.match(html, /10-session range and trend what-if/);
  assert.match(html, /Likely range · 8 in 10/);
  assert.match(html, /If the trend continued/);
  assert.doesNotMatch(html, /Projected change|\+4\.50%|trend projection/);
});

test('a priced breakout offer opens paid checkout even when a free trial is available', () => {
  const { BreakoutOffer } = require(outfile);
  const renderOffer = (access, count = 3) => renderToStaticMarkup(React.createElement(BreakoutOffer, {
    access, stock: { symbol: 'TCS', name: 'Tata Consultancy Services' }, count, onExample: noop,
  }));
  const offer = renderOffer({ signedIn: false });
  assert.match(offer, /Research all 3 breakouts/);
  assert.match(offer, /href="\/pro\/checkout\?symbol=TCS.NS"/);
  assert.match(offer, /Read TCS report/);
  assert.ok(renderOffer({ active: true, trialActive: true }));
  for (const access of [{ active: true }, { pending: true }, { paused: true }, { loading: true }, { configured: false }])
    assert.equal(renderOffer(access), '');
  assert.equal(renderOffer({}, 1), '');
  const checkout = renderToStaticMarkup(React.createElement(ProGate, {
    page: 'Breakouts', paidCheckout: true, access: { signedIn: true, trialEligible: true },
  }));
  assert.match(checkout, /₹300/);
  assert.match(checkout, /Submit payment reference/);
  assert.doesNotMatch(checkout, /class="button primary pro-next pro-start"/);
});
