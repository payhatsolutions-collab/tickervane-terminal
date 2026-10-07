import test from 'node:test';
import assert from 'node:assert/strict';
import { projectForecast, forecastProbabilities, compareForecasts, trendDriftPerDay, FORECAST_VERSION } from '../src/forecastModel.js';
import { forecastDates } from '../src/forecastCalendar.js';
import { chart } from '../api/market.js';
function history(n = 1000) {
  let price = 100, date = new Date('2021-01-01T12:00:00Z'), seed = 41;
  return Array.from({ length: n }, (_, i) => {
    do { date.setUTCDate(date.getUTCDate() + 1); } while ([0, 6].includes(date.getUTCDay()));
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    price *= Math.exp((seed / 4294967296 - .5) * (i % 150 < 75 ? .015 : .07));
    return { time: date.toISOString().slice(0, 10), close: price };
  });
}
test('all horizons produce reproducible positive nested bands and separate evaluation', () => {
  const bars = history();
  for (const horizon of [5, 10, 20, 30]) {
    const r = projectForecast(bars, horizon);
    assert.equal(r.points.length, horizon);
    assert.ok(r.evaluation.count >= 5);
    assert.ok(r.evaluation.selectionEnd <= r.evaluation.start);
    assert.ok(r.evaluation.selected.wis >= 0);
    assert.ok(r.evaluation.selected.brier >= 0 && r.evaluation.selected.brier <= 1);
    assert.equal(r.evaluation.calibration.reduce((n, row) => n + row.count, 0), r.evaluation.count);
    for (const p of r.points) {
      const values = [p.lower, p.lower80, p.lower50, p.close, p.upper50, p.upper80, p.upper];
      assert.ok(values.every((v, i) => Number.isFinite(v) && v > 0 && (!i || v >= values[i - 1])));
    }
    assert.deepEqual(projectForecast(bars, horizon), r);
  }
});
test('evaluation outcomes cannot change the selected model or tuning scores', () => {
  const bars = history(), first = projectForecast(bars, 20);
  const modified = bars.map(b => ({ ...b, close: b.time > first.evaluation.selectionEnd ? b.close * 1.5 : b.close }));
  const second = projectForecast(modified, 20);
  assert.equal(second.modelId, first.modelId);
  assert.deepEqual(second.evaluation.tuningScores, first.evaluation.tuningScores);
  assert.notDeepEqual(second.evaluation.selected, first.evaluation.selected);
});
test('short history uses baseline without invented accuracy and rejects malformed history', () => {
  const bars = history(80), r = projectForecast(bars, 30);
  assert.equal(r.modelId, 'baseline');
  assert.equal(r.evaluation.count, 0);
  assert.equal(r.evaluation.selected, null);
  assert.throws(() => projectForecast(bars.slice(0, 69)), /70/);
  assert.throws(() => projectForecast(bars, 7), /horizon/);
  assert.throws(() => projectForecast([...bars.slice(0, 79), bars[78]]), /unique/);
  assert.throws(() => projectForecast(bars.map((b, i) => i === 10 ? { ...b, close: NaN } : b)), /valid/);
});
test('threshold probabilities represent terminal returns and decrease with threshold', () => {
  const samples = [-.2, -.1, 0, .1, .2];
  assert.deepEqual(forecastProbabilities(samples, 5), { up: 40, gain: 40, loss: 40 });
  assert.equal(forecastProbabilities(samples, 100).loss, 0);
  const a = forecastProbabilities(samples, 5), b = forecastProbabilities(samples, 15);
  assert.ok(b.gain <= a.gain && b.loss <= a.loss);
});
test('NSE holidays, Muhurat session, crypto weekends and unsupported years are explicit', () => {
  assert.equal(forecastDates('2026-10-19', 5, 'RELIANCE.NS').dates[0], '2026-10-21');
  assert.equal(forecastDates('2026-11-06', 5, '^NSEI').dates[0], '2026-11-08');
  assert.ok(!forecastDates('2026-11-06', 5, '^NSEI').dates.includes('2026-11-10'));
  assert.equal(forecastDates('2026-01-14', 5, 'RELIANCE.NS').dates[0], '2026-01-16');
  assert.equal(forecastDates('2026-10-09', 5, 'BTC-USD').dates[0], '2026-10-10');
  assert.match(forecastDates('2026-12-31', 5, '^NSEI').note, /Estimated/);
  assert.match(forecastDates('2026-10-09', 5, 'AAPL').note, /Estimated/);
});
test('daily five-year history uses daily upstream interval and a separate cache key', async () => {
  const original = global.fetch, urls = [];
  global.fetch = async url => {
    urls.push(String(url));
    return { ok: true, json: async () => ({ chart: { result: [{ meta: {}, timestamp: [1704067200], indicators: { quote: [{ open: [100], high: [100], low: [100], close: [100] }], adjclose: [{ adjclose: [100] }] } }] } }) };
  };
  try {
    await chart('TESTDAILY.NS', '5y', true, true);
    await chart('TESTDAILY.NS', '5y', true, false);
    assert.ok(urls[0].includes('interval=1d'));
    assert.ok(urls[1].includes('interval=1wk'));
  } finally { global.fetch = original; }
});
test('headline follows the 30-session trend so it reads as a forecast, not the LTP', () => {
  const bars = history(1000);
  const r = projectForecast(bars, 10);
  assert.ok(Number.isFinite(r.driftPerDay));
  assert.ok(Math.abs(r.driftPerDay) <= 0.01);
  assert.ok(Math.abs(r.change) > 0.05, `expected a visible move, got ${r.change}%`);
  assert.ok(Math.abs(r.points.at(-1).close / r.lastClose - 1) > 0.0005);
  // Flat history stays flat; bands remain nested and positive.
  const flat = bars.map(b => ({ ...b, close: 100 }));
  const rf = projectForecast(flat, 10);
  assert.ok(Math.abs(rf.change) < 1e-9);
  assert.equal(trendDriftPerDay([0.001, 0.001, NaN]), 0);
});
test('v3 evaluates six candidates and reads ties as ties, not failures', () => {
  const bars = history();
  const r = projectForecast(bars, 20);
  assert.equal(r.version, '3.1.0');
  assert.equal(FORECAST_VERSION, '3.1.0');
  assert.equal(r.evaluation.tuningScores.length, 6);
  assert.ok(['baseline', 'ewma', 'garch', 'garch-drift', 'har', 'har-trend'].includes(r.modelId));
  assert.equal(compareForecasts(1, 1), 'tie');
  assert.equal(compareForecasts(0.9, 1), 'beat');
  assert.equal(compareForecasts(1.1, 1), 'trail');
  assert.equal(compareForecasts(NaN, 1), 'unknown');
});
