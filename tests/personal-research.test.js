import test from 'node:test';
import assert from 'node:assert/strict';
import { historyAnalytics, historySeries, screenAnalytics, breakoutInsight } from '../src/researchAnalytics.js';
import { sortRows } from '../src/table.js';
import { cleanPersonalRule, evaluatePersonalRules } from '../src/personalAlerts.js';
import { buildBackup, parseBackup } from '../src/backup.js';
import { viewURL, viewFromLocation } from '../src/navigation.js';

const rule = { id: 'rule-1', name: 'Breakouts', scope: 'watchlist', metric: 'breakout20', threshold: 1, operator: 'min', frequency: 'daily', enabled: true };
const snapshot = { date: '2026-10-30', rows: [
  { symbol: 'TCS', breakout20: true, volRatio: 1.3 },
  { symbol: 'INFY', breakout20: true, volRatio: 2 },
  { symbol: 'ITC', breakout20: true, volRatio: null },
] };
const now = new Date('2026-11-01T08:00:00Z');
test('personalized rules scope to watchlist, confirm volume and deduplicate by session', () => {
  const result = evaluatePersonalRules([rule], snapshot, ['TCS.NS', 'ITC.NS'], now);
  assert.deepEqual(result.events[0].symbols, ['TCS.NS']);
  assert.equal(result.rules[0].enabled, true);
  assert.equal(evaluatePersonalRules(result.rules, snapshot, ['TCS.NS'], now).events.length, 0);
  assert.equal(evaluatePersonalRules(result.rules, { ...snapshot, date: '2026-11-02' }, ['TCS.NS'], new Date('2026-11-02T12:00:00Z')).events.length, 1);
});
test('once-only rules pause after firing; paused, old, future and undated signals do not fire', () => {
  assert.equal(evaluatePersonalRules([{ ...rule, frequency: 'once' }], snapshot, ['TCS.NS'], now).rules[0].enabled, false);
  assert.equal(evaluatePersonalRules([{ ...rule, enabled: false }], snapshot, ['TCS.NS'], now).events.length, 0);
  for (const date of [undefined, '2026-09-01', '2026-12-01']) assert.equal(evaluatePersonalRules([rule], { ...snapshot, date }, ['TCS.NS'], now).events.length, 0);
});
test('numeric rules handle zero, missing data, invalid rules and individual-stock scope', () => {
  const r = { ...rule, scope: 'TCS.NS', metric: 'change', operator: 'max', threshold: 0 };
  assert.equal(evaluatePersonalRules([r], { ...snapshot, rows: [{ symbol: 'TCS', change: 0 }] }, [], now).events.length, 1);
  for (const change of [null, undefined, NaN, 1]) assert.equal(evaluatePersonalRules([r], { ...snapshot, rows: [{ symbol: 'TCS', change }] }, [], now).events.length, 0);
  for (const bad of [{ metric: '__proto__' }, { scope: '*' }, { threshold: Infinity }, { metric: 'rsi', threshold: 101 }]) assert.equal(cleanPersonalRule({ ...rule, ...bad }), null);
});
test('risk analytics compute return and peak-to-trough drawdown without inventing sparse risk metrics', () => {
  const bars = [100, 120, 90, 110].map((close, i) => ({ time: `2026-10-0${i + 1}`, close }));
  const stats = historyAnalytics(bars);
  assert.ok(Math.abs(stats.totalReturn - 10) < 1e-10);
  assert.equal(stats.maxDrawdown, -25);
  assert.equal(stats.volatility, null); assert.equal(stats.beta, null);
  assert.equal(historyAnalytics([]).totalReturn, null);
  assert.equal(historyAnalytics([{ time: '2026-10-01', close: 0 }]).sessions, 0);
});
test('beta and correlation align complete date pairs and suppress zero-variance metrics', () => {
  const bars = Array.from({ length: 30 }, (_, i) => ({ time: `2026-10-${String(i + 1).padStart(2, '0')}`, close: 100 + i + Math.sin(i) }));
  const stats = historyAnalytics(bars, bars);
  assert.ok(Math.abs(stats.beta - 1) < 1e-10);
  assert.ok(Math.abs(stats.correlation - 1) < 1e-10);
  assert.equal(stats.pairs, 29);
  assert.equal(historyAnalytics(bars, bars.filter((_, i) => i !== 12)).pairs, 27);
  const flat = bars.map(bar => ({ ...bar, close: 100 }));
  assert.equal(historyAnalytics(flat, flat).sharpe, null);
  assert.equal(historyAnalytics(flat, flat).beta, null);
  assert.equal(historyAnalytics(flat).volatility, 0);
});
test('market analytics exclude missing observations and insight copy exposes failed confirmation', () => {
  const stats = screenAnalytics([{ industry: 'IT', above200: true, rs3m: 0 }, { industry: 'IT', above200: null, rs3m: null }, { industry: 'Bank', above200: false, rs3m: 10 }]);
  assert.equal(stats.trendPercent, 50); assert.equal(stats.medianRS, 5);
  assert.equal(stats.sectors[0].count, 2);
  const insight = breakoutInsight({ breakout20: true, volRatio: 1.2, rsi: 80, above200: false, rs3m: -5 });
  assert.equal(insight.confirmed, false); assert.equal(insight.cautions.length, 4);
});
test('performance charts rebase on shared dates while drawdown keeps the full stock history', () => {
  const bars = [100, 120, 90, 110].map((close, i) => ({ time: `2026-10-0${i + 1}`, close }));
  const series = historySeries(bars, [{ time: '2026-10-02', close: 200 }, { time: '2026-10-04', close: 220 }]);
  assert.equal(series.benchmarkAligned, true);
  assert.deepEqual(series.performance.map(point => point.time), ['2026-10-02', '2026-10-04']);
  assert.equal(series.performance[0].value, 0);
  assert.equal(series.performance[0].benchmark, 0);
  assert.ok(Math.abs(series.performance[1].value - (110 / 120 - 1) * 100) < 1e-10);
  assert.ok(Math.abs(series.performance[1].benchmark - 10) < 1e-10);
  assert.equal(series.drawdown.length, 4);
  assert.equal(Math.min(...series.drawdown.map(point => point.value)), historyAnalytics(bars).maxDrawdown);
});
test('chart series handles invalid, duplicate, unordered and missing benchmark history', () => {
  const series = historySeries([
    { time: '2026-10-02', close: 0 }, { time: '2026-10-03', close: 120 },
    { time: '2026-10-01', close: 50 }, { time: '2026-10-01', close: 100 },
    { time: 'invalid', close: 999 }, { time: '2026-10-04', close: NaN },
  ], [{ time: '2026-10-01', close: 200 }]);
  assert.equal(series.benchmarkAligned, false);
  assert.equal(series.performance.length, 2);
  assert.equal(series.performance[0].time, '2026-10-01');
  assert.ok(Math.abs(series.performance[1].value - 20) < 1e-10);
  assert.ok(series.performance.every(point => point.benchmark === null));
  assert.deepEqual(historySeries([]), { benchmarkAligned: false, performance: [], drawdown: [] });
});
test('industry returns sort numerically in either direction with missing medians last', () => {
  const stats = screenAnalytics([
    { industry: 'Negative', r3m: -5 }, { industry: 'Flat', r3m: 0 },
    { industry: 'Positive', r3m: 12 }, { industry: 'Positive', r3m: 8 },
    { industry: 'Missing', r3m: null },
  ]);
  assert.deepEqual(sortRows(stats.sectors, ['return3m', -1]).map(row => row.industry), ['Positive', 'Flat', 'Negative', 'Missing']);
  assert.deepEqual(sortRows(stats.sectors, ['return3m', 1]).map(row => row.industry), ['Negative', 'Flat', 'Positive', 'Missing']);
  assert.equal(stats.sectors[0].industry, 'Positive');
});
test('personal rules survive backups while older backups preserve existing personal rules', () => {
  const payload = buildBackup({ watch: [], positions: [], alerts: [], personalRules: [rule, { ...rule, metric: 'bogus' }] });
  assert.equal(parseBackup(payload).personalRules.length, 1);
  assert.equal(parseBackup({ watch: [], positions: [], alerts: [] }).personalRules, null);
});
test('new research routes retain stock identity on reload and restore from browser navigation', () => {
  for (const page of ['Breakouts', 'Analytics']) {
    const path = viewURL('https://example.com/', { page, symbol: 'TCS.NS', range: '1y' }, { share: false });
    assert.ok(path.includes('symbol=TCS.NS'));
    assert.deepEqual(viewFromLocation(new URL(path, 'https://example.com')), { page, symbol: 'TCS.NS', range: '6mo' });
  }
});
