import test from 'node:test';
import assert from 'node:assert/strict';
import { projectForecast, forecastProbabilities, compareForecasts, trendDriftPerDay, selectForecastCandidate, scoreForecast, FORECAST_VERSION } from '../src/forecastModel.js';
import { forecastDates } from '../src/forecastCalendar.js';
import { chart, normalize } from '../api/market.js';
import { completedForecastBars } from '../src/forecastHistory.js';
import { fitDirectMean } from '../src/forecastRegression.js';
import { trendScenario, TREND_SESSIONS } from '../src/forecastScenario.js';
import { Worker } from 'node:worker_threads';
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
    assert.ok(r.evaluation.records.every(row => row.selectionEnd <= row.date));
    assert.ok(r.evaluation.selectionEnd <= bars.at(-1).time);
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
test('future outcomes cannot change an earlier rolling selection or forecast', () => {
  const bars = history(), cutoff = bars[800].time;
  const first = projectForecast(bars, 10);
  const modified = bars.map(b => ({ ...b, close: b.time > cutoff ? b.close * 1.5 : b.close }));
  const second = projectForecast(modified, 10);
  const past = result => result.evaluation.records.filter(row => row.origin + 10 <= 800);
  assert.ok(past(first).length > 0);
  assert.deepEqual(past(first), past(second));
  assert.notDeepEqual(second.evaluation.selected, first.evaluation.selected);
  // A historical selection must match what a real prefix-only run selected.
  const row = first.evaluation.records[0];
  const prefix = projectForecast(bars.slice(0, row.origin + 1), 10, { includeEvaluation: false });
  assert.equal(row.modelId, prefix.modelId);
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
test('the displayed median matches its samples and never adds a second trend', () => {
  for (const drift of [.001, -.001]) {
    const bars = history().map((b, i) => ({ ...b, close: 100 * Math.exp(drift * i) }));
    const r = projectForecast(bars, 10);
    const samples = r.samples, median = (samples[2047] + samples[2048]) / 2;
    assert.ok(Math.abs(r.change - Math.expm1(drift * 10) * 100) < 1e-6);
    assert.ok(Math.abs(Math.log(r.points.at(-1).close / r.lastClose) - median) < 1e-12);
    assert.ok(r.evaluation.selected.returnMae < 1e-8);
  }
  const flat = history().map(b => ({ ...b, close: 100 }));
  assert.ok(Math.abs(projectForecast(flat, 10).change) < 1e-9);
  assert.equal(trendDriftPerDay([0.001, 0.001, NaN]), 0);
});
test('v4 evaluates explicit mean candidates and reads baseline ties correctly', () => {
  const bars = history();
  const r = projectForecast(bars, 20);
  assert.equal(r.version, '4.0.0');
  assert.equal(FORECAST_VERSION, '4.0.0');
  assert.equal(r.evaluation.tuningScores.length, 6);
  const research = projectForecast(bars, 20, { experimentalMeans: true });
  assert.equal(research.evaluation.tuningScores.length, 8);
  assert.ok(research.evaluation.tuningScores.some(row => row.id === 'ridge-direct'));
  assert.ok(['baseline', 'ewma', 'garch', 'garch-drift', 'har', 'har-trend', 'trend-30', 'ridge-direct'].includes(r.modelId));
  assert.equal(compareForecasts(1, 1), 'tie');
  assert.equal(compareForecasts(0.9, 1), 'beat');
  assert.equal(compareForecasts(1.1, 1), 'trail');
  assert.equal(compareForecasts(NaN, 1), 'unknown');
});

test('selection prioritizes headline error and gates interval degradation', () => {
  const baseline = { id: 'baseline', returnMae: 5, wis: .02 };
  assert.equal(selectForecastCandidate([baseline, { id: 'bad-point', returnMae: 6, wis: .01 }]), 'baseline');
  assert.equal(selectForecastCandidate([baseline, { id: 'uncertainty', returnMae: 5, wis: .018 }]), 'uncertainty');
  assert.equal(selectForecastCandidate([baseline, { id: 'small-gain', returnMae: 4.8, wis: .019 }]), 'baseline');
  assert.equal(selectForecastCandidate([baseline, { id: 'bad-bands', returnMae: 4, wis: .03 }]), 'baseline');
  assert.equal(selectForecastCandidate([baseline, { id: 'better', returnMae: 4, wis: .0205 }]), 'better');
});

test('headline and directional errors measure the displayed return', () => {
  const r = scoreForecast([Math.log(.9), 0, Math.log(1.1)], Math.log(1.05));
  assert.ok(Math.abs(r.returnMae - 5) < 1e-10);
  assert.ok(Math.abs(r.squaredReturnError - 25) < 1e-10);
  assert.equal(r.directionCalled, 0);
  assert.equal(r.directionHit, 0);
});

test('direct horizon regression learns the full target without recursive drift', () => {
  const bars = history(600).map((b, i) => ({ ...b, close: 100 * Math.exp(.001 * i) }));
  for (const horizon of [5, 10, 20, 30]) {
    const model = fitDirectMean(bars, horizon);
    assert.equal(model.available, true);
    assert.ok(Math.abs(model.prediction - .001 * horizon) < 1e-10);
    assert.equal(model.trainedThrough, bars.at(-1).time);
  }
});

test('context features use dated past observations and reject missing latest factors', () => {
  const bars = history(600).map((b, i) => ({ ...b, volume: 1000 + i }));
  const full = history(650).map((b, i) => ({ ...b, close: 100 + i }));
  const first = fitDirectMean(bars, 10, { market: full });
  const futureChanged = full.map((b, i) => i >= 600 ? { ...b, close: 1e9 } : b);
  assert.deepEqual(fitDirectMean(bars, 10, { market: futureChanged }), first);
  assert.equal(first.available, true);
  assert.equal(fitDirectMean(bars, 10, { market: full.filter(b => b.time !== bars.at(-1).time) }).available, false);
  assert.equal(fitDirectMean(bars.map(b => ({ ...b, volume: 0 })), 10, { market: full }).available, false);
});

function sessionHistory(timezone = 'Asia/Kolkata') {
  return { timezone, bars: [{ time: '2026-10-26', close: 100 }, { time: '2026-10-27', close: 101 }],
    regularSession: { start: Date.parse('2026-10-27T03:45:00Z') / 1000, end: Date.parse('2026-10-27T10:00:00Z') / 1000 },
    marketTime: Date.parse('2026-10-27T09:59:59Z') / 1000, fetchedAt: '2026-10-27T10:20:00Z' };
}

test('forecast includes a confirmed close after settlement, without admitting an open session', () => {
  const data = sessionHistory();
  assert.equal(completedForecastBars(data, new Date('2026-10-27T10:21:00Z')).length, 2);
  assert.equal(completedForecastBars(data, new Date('2026-10-27T09:00:00Z')).length, 1);
  assert.equal(completedForecastBars({ ...data, fetchedAt: '2026-10-27T10:10:00Z' }, new Date('2026-10-27T10:21:00Z')).length, 1);
  assert.equal(completedForecastBars({ ...data, regularSession: null }, new Date('2026-10-27T10:21:00Z')).length, 1);
  assert.equal(completedForecastBars({ ...data, marketTime: data.marketTime - 600 }, new Date('2026-10-27T10:21:00Z')).length, 1);
  assert.equal(completedForecastBars({ ...data, timezone: 'invalid' }, new Date('2026-10-27T10:21:00Z')).length, 0);
});

test('session completion follows exchange timestamps through US daylight saving', () => {
  for (const [date, open, close] of [['2026-10-27', '13:30', '20:00'], ['2026-11-03', '14:30', '21:00']]) {
    const data = sessionHistory('America/New_York');
    data.bars.at(-1).time = date;
    data.regularSession = { start: Date.parse(`${date}T${open}:00Z`) / 1000, end: Date.parse(`${date}T${close}:00Z`) / 1000 };
    data.marketTime = data.regularSession.end - 1;
    const settled = new Date((data.regularSession.end + 20 * 60) * 1000);
    data.fetchedAt = settled.toISOString();
    assert.equal(completedForecastBars(data, settled).at(-1).time, date);
    assert.equal(completedForecastBars(data, new Date((data.regularSession.end - 60) * 1000)).some(b => b.time === date), false);
  }
});

test('normalization retains exchange session evidence only when valid', () => {
  const raw = { meta: { currentTradingPeriod: { regular: { start: 100, end: 200 } } }, timestamp: [1704067200],
    indicators: { quote: [{ open: [100], high: [100], low: [100], close: [100] }] } };
  assert.deepEqual(normalize(raw, 'AAPL', '1y').regularSession, { start: 100, end: 200 });
  raw.meta.currentTradingPeriod.regular.end = 50;
  assert.equal(normalize(raw, 'AAPL', '1y').regularSession, undefined);
});

test('the actual forecast worker returns the corrected result and recoverable errors', { timeout: 10000 }, async t => {
  const url = new URL('../src/forecast.worker.js', import.meta.url).href;
  const worker = new Worker(`(async () => {
    const { parentPort } = await import('node:worker_threads');
    globalThis.self = { postMessage: result => parentPort.postMessage(result) };
    await import(${JSON.stringify(url)});
    parentPort.on('message', data => self.onmessage({ data }));
  })()`, { eval: true });
  t.after(() => worker.terminate());
  const request = data => new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.postMessage(data);
  });
  assert.match((await request({ bars: [], horizon: 10 })).error, /70/);
  const answer = await request({ bars: history(80), horizon: 10, symbol: 'AAPL' });
  assert.equal(answer.result.version, '4.0.0');
  assert.equal(answer.result.points.length, 10);
  assert.equal(answer.result.modelId, 'baseline');
  assert.ok(Math.abs(answer.result.change) < 1e-9);
});

test('the trend what-if extends the last 30 sessions and is kept apart from the forecast', () => {
  const steady = Array.from({ length: 60 }, (_, i) => ({ time: i, close: 100 * Math.exp(0.002 * i) }));
  const up = trendScenario(steady, 10);
  assert.equal(up.sessions, TREND_SESSIONS);
  assert.ok(Math.abs(up.close - steady.at(-1).close * Math.exp(0.02)) < 1e-9);
  assert.ok(Math.abs(up.change - Math.expm1(0.02) * 100) < 1e-9);
  assert.equal(up.capped, false);
  const down = trendScenario(steady.map((bar, i) => ({ ...bar, close: 100 * Math.exp(-0.003 * i) })), 10);
  assert.ok(Math.abs(down.change - Math.expm1(-0.03) * 100) < 1e-9);
  // Only the last 30 sessions count: an earlier slide does not bend the slope.
  const recent = [...Array.from({ length: 40 }, (_, i) => ({ close: 500 - i * 5 })), ...steady.slice(-31)];
  assert.ok(Math.abs(trendScenario(recent, 10).change - up.change) < 1e-9);
  // A flat series has no trend to extend; a runaway one is capped at 1% a session.
  assert.equal(trendScenario(steady.map(bar => ({ ...bar, close: 100 })), 10).change, 0);
  const runaway = trendScenario(steady.map((bar, i) => ({ ...bar, close: 100 * Math.exp(0.05 * i) })), 10);
  assert.equal(runaway.capped, true);
  assert.ok(Math.abs(runaway.change - Math.expm1(0.1) * 100) < 1e-9);
  // Too little or invalid history gives no scenario, never a made-up one.
  assert.equal(trendScenario(steady.slice(-30), 10), null);
  assert.equal(trendScenario(steady.map((bar, i) => i === 59 ? { ...bar, close: NaN } : bar), 10), null);
  assert.equal(trendScenario(null), null);
  // The forecast does not move with the trend: a steadily rising history still selects on tested error alone,
  // and the scenario is not a field of the model's output.
  const bars = history();
  const forecast = projectForecast(bars, 10);
  assert.equal(forecast.version, FORECAST_VERSION);
  assert.ok(!('whatIf' in forecast) && !('scenario' in forecast));
  const scenario = trendScenario(bars, 10);
  const logs = bars.map(bar => Math.log(bar.close));
  assert.ok(Math.abs(Math.log(scenario.close / bars.at(-1).close) - trendDriftPerDay(logs.slice(1).map((x, i) => x - logs[i])) * 10) < 1e-12);
});
