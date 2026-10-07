// Forecast v3: chronological tuning/evaluation, fixed candidate family and seeded simulation.
// v3 adds two realized-volatility candidates built on a HAR-RV regression
// (daily/weekly/monthly realized variance, Corsi 2009): HAR volatility with
// a zero mean, and HAR volatility with a ridge-regularized momentum mean.
// A small neural net was prototyped for the conditional mean and rejected:
// on 250–500 daily returns its one-step RMSE lost to predicting zero, so it
// never earned selection. Volatility is where the forecast skill lives.
// Everything is refit from data available at each backtest origin only, with
// seeded arithmetic, so every projection is exactly reproducible.
import { forecastDates } from './forecastCalendar.js';

export const FORECAST_VERSION = '3.1.0';

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const quantile = (xs, p) => { const x = (xs.length - 1) * p, i = Math.floor(x); return xs[i] + (xs[Math.min(i + 1, xs.length - 1)] - xs[i]) * (x - i); };

const candidates = [
  { id: 'baseline', label: 'Random walk · constant volatility', window: 252, type: 'constant' },
  { id: 'ewma', label: 'Random walk · adaptive volatility', window: 252, type: 'ewma' },
  { id: 'garch', label: 'GARCH(1,1) · Student-t', window: 504, type: 'garch' },
  { id: 'garch-drift', label: 'Regularized drift · GARCH Student-t', window: 504, type: 'garch', drift: true },
  { id: 'har', label: 'HAR volatility · Student-t', window: 504, type: 'har' },
  { id: 'har-trend', label: 'HAR volatility · Ridge momentum', window: 504, type: 'har-trend' },
];

// ---------------------------------------------------------------------------
// Headline trend drift: linear trend of cumulative log-returns over the last
// 30 sessions, clamped to ±1%/day. Zero-drift medians are statistically safe
// but read as "just the LTP" — this gives the headline number a direction
// while bands still carry the volatility-model uncertainty. Experimental.
// ---------------------------------------------------------------------------
export function trendDriftPerDay(returns) {
  const window = returns.slice(-30);
  if (window.length < 10 || window.some(x => !Number.isFinite(x))) return 0;
  const n = window.length;
  let cum = 0;
  const ys = window.map(r => (cum += r));
  const mx = (n - 1) / 2, my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (ys[i] - my); den += (i - mx) * (i - mx); }
  if (!(den > 0)) return 0;
  return Math.max(-0.01, Math.min(0.01, num / den));
}

// ---------------------------------------------------------------------------
// Learned conditional-mean models. Features are stationary (all in
// log-return units): five daily lags, 5-day and 20-day momentum, and 20-day
// realized dispersion. Standardized inside each training window.
// ---------------------------------------------------------------------------
const FEATURES = 8;
const HISTORY_LAGS = 20;

function returnFeatures(history) {
  const n = history.length;
  const lag = k => (n - k >= 0 ? history[n - k] : 0);
  let momentum5 = 0, momentum20 = 0;
  for (let k = 1; k <= 5; k++) momentum5 += lag(k);
  momentum5 /= 5;
  for (let k = 1; k <= HISTORY_LAGS; k++) momentum20 += lag(k);
  momentum20 /= HISTORY_LAGS;
  let dispersion = 0;
  for (let k = 1; k <= HISTORY_LAGS; k++) dispersion += (lag(k) - momentum20) ** 2;
  return [lag(1), lag(2), lag(3), lag(4), lag(5), momentum5, momentum20, Math.sqrt(dispersion / HISTORY_LAGS)];
}

function designRows(returns) {
  const rows = [];
  for (let i = HISTORY_LAGS; i < returns.length; i++) rows.push({ end: i, x: returnFeatures(returns.slice(0, i)), y: returns[i] });
  return rows;
}

function standardizeColumns(rows) {
  const p = rows[0].x.length;
  const center = Array(p).fill(0), scale = Array(p).fill(0);
  for (const row of rows) for (let j = 0; j < p; j++) center[j] += row.x[j];
  for (let j = 0; j < p; j++) center[j] /= rows.length;
  for (const row of rows) for (let j = 0; j < p; j++) scale[j] += (row.x[j] - center[j]) ** 2;
  for (let j = 0; j < p; j++) { scale[j] = Math.sqrt(scale[j] / rows.length); if (!(scale[j] > 1e-10)) scale[j] = 1; }
  return { center, scale };
}

function solveLinear(system, rhs) {
  const n = rhs.length;
  const augmented = system.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row;
    if (!(Math.abs(augmented[pivot][col]) > 1e-12)) continue;
    [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = augmented[row][col] / augmented[col][col];
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) augmented[row][k] -= factor * augmented[col][k];
    }
  }
  return augmented.map((row, i) => (Math.abs(row[i]) > 1e-12 ? row[n] / row[i] : 0));
}

// Ridge-regularized linear map from momentum features to next-day return.
// Lambda is fixed before any evaluation, so no tuning-set peeking.
const RIDGE_LAMBDA = 20;
export function fitRidgeMean(returns) {
  const rows = designRows(returns);
  if (rows.length < 30) return { predict: () => 0, residuals: returns.slice() };
  const { center, scale } = standardizeColumns(rows);
  const dimension = FEATURES + 1;
  const system = Array.from({ length: dimension }, () => Array(dimension).fill(0));
  const rhs = Array(dimension).fill(0);
  for (const row of rows) {
    const extended = [...row.x.map((value, j) => (value - center[j]) / scale[j]), 1];
    for (let a = 0; a < dimension; a++) {
      rhs[a] += extended[a] * row.y;
      for (let b = 0; b < dimension; b++) system[a][b] += extended[a] * extended[b];
    }
  }
  for (let j = 0; j < FEATURES; j++) system[j][j] += RIDGE_LAMBDA;
  const weights = solveLinear(system, rhs);
  const raw = x => {
    let value = weights[FEATURES];
    for (let j = 0; j < FEATURES; j++) value += weights[j] * (x[j] - center[j]) / scale[j];
    return value;
  };
  return { predict: history => raw(returnFeatures(history)), residuals: rows.map(row => row.y - raw(row.x)) };
}

// HAR-RV-lite: ordinary least squares of squared returns on daily, weekly
// (5d) and monthly (22d) realized variance, in levels with a positivity
// floor. Fixed specification, no tuned hyperparameters, refit per window.
const HAR_LAGS = 22;
function harRealized(history) {
  const n = history.length;
  const sq = k => (n - k >= 0 ? history[n - k] : 0) ** 2;
  let weekly = 0, monthly = 0;
  for (let k = 1; k <= 5; k++) weekly += sq(k);
  for (let k = 1; k <= HAR_LAGS; k++) monthly += sq(k);
  return [sq(1), weekly / 5, monthly / HAR_LAGS];
}
function fitHarVariance(returns) {
  const rows = [];
  for (let i = HAR_LAGS; i < returns.length; i++) rows.push({ x: [1, ...harRealized(returns.slice(0, i))], y: returns[i] ** 2 });
  const trainVariance = Math.max(1e-12, mean(returns.map(x => x * x)));
  if (rows.length < 30) return { coefs: [trainVariance, 0, 0, 0], trainVariance };
  const dimension = 4;
  const system = Array.from({ length: dimension }, () => Array(dimension).fill(0));
  const rhs = Array(dimension).fill(0);
  for (const row of rows) for (let a = 0; a < dimension; a++) {
    rhs[a] += row.x[a] * row.y;
    for (let b = 0; b < dimension; b++) system[a][b] += row.x[a] * row.x[b];
  }
  for (let j = 1; j < dimension; j++) system[j][j] += 1e-8;
  const coefs = solveLinear(system, rhs);
  return { coefs, trainVariance };
}
function harForecast(coefs, trainVariance, history) {
  const [daily, weekly, monthly] = harRealized(history);
  const raw = coefs[0] + coefs[1] * daily + coefs[2] * weekly + coefs[3] * monthly;
  // Floor at zero variance, cap at 25x the training variance (5x volatility):
  // part of the fixed model spec, applied identically in tuning and live.
  return Math.min(25 * trainVariance, Math.max(1e-12, raw));
}

// Variance-targeted, bounded grid fit; df=7 fixed before evaluation.
// Student-t likelihood uses variance-standardized residuals (df - 2 = 5).
function garchGrid(residuals, variance) {
  let best;
  for (const alpha of [.03, .07, .12]) for (const beta of [.8, .9, .95]) {
    if (alpha + beta >= .995) continue;
    const omega = variance * (1 - alpha - beta);
    let v = variance, loss = 0;
    for (const r of residuals) {
      loss += .5 * Math.log(v) + 4 * Math.log1p(r * r / (5 * v));
      v = omega + alpha * r * r + beta * v;
    }
    if (!best || loss < best.loss) best = { variance: v, alpha, beta, omega, student: true, loss };
  }
  return best;
}

function fit(returns, candidate) {
  const xs = returns.slice(-candidate.window), average = mean(xs);
  const variance = Math.max(1e-12, mean(xs.map(x => (x - average) ** 2)));
  if (candidate.type === 'har' || candidate.type === 'har-trend') {
    const har = fitHarVariance(xs);
    let meanPredict = null, meanBias = 0;
    if (candidate.type === 'har-trend') {
      const meanModel = fitRidgeMean(xs);
      meanPredict = meanModel.predict;
      meanBias = mean(meanModel.residuals);
    }
    const padding = Array(Math.max(0, HAR_LAGS - xs.length)).fill(0);
    return { ...har, variance: harForecast(har.coefs, har.trainVariance, xs), drift: 0, student: true,
      meanPredict, meanBias, tail: [...padding, ...xs.slice(-HAR_LAGS)] };
  }
  const drift = candidate.drift ? Math.max(-Math.sqrt(variance / xs.length), Math.min(Math.sqrt(variance / xs.length), average * .2)) : 0;
  const residuals = xs.map(x => x - drift);
  if (candidate.type === 'constant') return { variance, drift, alpha: 0, beta: 1, omega: 0, student: false };
  if (candidate.type === 'ewma') {
    let v = variance;
    for (const r of residuals) v = .94 * v + .06 * r * r;
    return { variance: v, drift, alpha: .06, beta: .94, omega: 0, student: false };
  }
  return { ...garchGrid(residuals, variance), drift };
}

function random(seed) {
  let state = seed >>> 0;
  const uniform = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return (state + .5) / 4294967296; };
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

// Per-step conditional means are clamped: a learned daily mean beyond ±2%
// (≈ ±5000% annualized) is estimation noise, not signal, and would let
// recursive simulation explode.
const MEAN_CLAMP = 0.02;

function simulate(model, horizon, count, seed) {
  const normal = random(seed), steps = Array.from({ length: horizon }, () => []);
  // Antithetic pairs reduce Monte Carlo noise and preserve a zero-drift median.
  for (let i = 0; i < count / 2; i++) {
    if (model.coefs) {
      // HAR volatility: variance is reforecast every step from the path's
      // own realized history, so scenarios develop volatility clustering.
      let historyA = model.tail.slice(), historyB = model.tail.slice();
      let totalA = 0, totalB = 0;
      for (let h = 0; h < horizon; h++) {
        const rawA = model.meanPredict ? model.meanPredict(historyA) + model.meanBias : 0;
        const rawB = model.meanPredict ? model.meanPredict(historyB) + model.meanBias : 0;
        const muA = Math.max(-MEAN_CLAMP, Math.min(MEAN_CLAMP, rawA));
        const muB = Math.max(-MEAN_CLAMP, Math.min(MEAN_CLAMP, rawB));
        const shock = normal();
        let scale = 1;
        if (model.student) { let chi = 0; for (let k = 0; k < 7; k++) chi += normal() ** 2; scale = Math.sqrt(5 / Math.max(chi, 1e-12)); }
        const stepA = Math.sqrt(harForecast(model.coefs, model.trainVariance, historyA)) * shock * scale;
        const stepB = -Math.sqrt(harForecast(model.coefs, model.trainVariance, historyB)) * shock * scale;
        totalA += muA + stepA; totalB += muB + stepB;
        steps[h].push(totalA, totalB);
        historyA.push(muA + stepA); historyB.push(muB + stepB);
        if (historyA.length > 40) historyA.splice(0, historyA.length - 40);
        if (historyB.length > 40) historyB.splice(0, historyB.length - 40);
      }
      continue;
    }
    let v = model.variance, log = 0;
    for (let h = 0; h < horizon; h++) {
      let shock = normal();
      if (model.student) { let chi = 0; for (let k = 0; k < 7; k++) chi += normal() ** 2; shock *= Math.sqrt(5 / Math.max(chi, 1e-12)); }
      const r = Math.sqrt(v) * shock;
      log += r;
      steps[h].push(model.drift * (h + 1) + log, model.drift * (h + 1) - log);
      v = model.omega + model.alpha * r * r + model.beta * v;
    }
  }
  return steps.map(xs => xs.sort((a, b) => a - b));
}

function summarize(samples) {
  return { median: quantile(samples, .5), low50: quantile(samples, .25), high50: quantile(samples, .75), low80: quantile(samples, .1), high80: quantile(samples, .9), low95: quantile(samples, .025), high95: quantile(samples, .975) };
}

function score(samples, actual) {
  const q = summarize(samples);
  const interval = (l, u, alpha) => u - l + 2 / alpha * Math.max(0, l - actual, actual - u);
  const probability = samples.filter(x => x > 0).length / samples.length;
  return {
    // Weighted interval score in log-return units, rewards calibration AND sharpness.
    wis: (.5 * Math.abs(q.median - actual) + .1 * interval(q.low80, q.high80, .2) + .025 * interval(q.low95, q.high95, .05)) / 2.5,
    error: Math.abs(q.median - actual) * 100,
    coverage80: actual >= q.low80 && actual <= q.high80 ? 100 : 0,
    coverage95: actual >= q.low95 && actual <= q.high95 ? 100 : 0,
    brier: (probability - Number(actual > 0)) ** 2, probability, outcome: Number(actual > 0),
  };
}

export function forecastProbabilities(samples, threshold = 5) {
  const magnitude = Math.abs(threshold) / 100;
  return { up: mean(samples.map(x => Number(x > 0))) * 100,
    gain: mean(samples.map(x => Number(x >= Math.log1p(magnitude)))) * 100,
    loss: magnitude >= 1 ? 0 : mean(samples.map(x => Number(x <= Math.log1p(-magnitude)))) * 100 };
}

// Three-way backtest verdict with a tie band: a model that matches the
// baseline within half a percent tied it; only larger gaps are wins/losses.
// (The old UI read every tie — including baseline-vs-itself — as a failure.)
export function compareForecasts(selectedWis, baselineWis) {
  if (!Number.isFinite(selectedWis) || !Number.isFinite(baselineWis)) return 'unknown';
  if (selectedWis < baselineWis * 0.995) return 'beat';
  if (selectedWis > baselineWis * 1.005) return 'trail';
  return 'tie';
}

export function projectForecast(bars, horizon = 10, options = {}) {
  if (![5, 10, 20, 30].includes(horizon)) throw new Error('Choose a supported forecast horizon.');
  if (bars.length < 70 || bars.some(b => !Number.isFinite(b.close) || b.close <= 0)) throw new Error('At least 70 valid daily prices are needed for a forecast.');
  const times = bars.map(b => typeof b.time === 'number' ? b.time * 1000 : Date.parse(`${b.time}T12:00:00Z`));
  if (times.some((t, i) => !Number.isFinite(t) || (i && t <= times[i - 1]))) throw new Error('History must contain unique, chronological daily sessions.');
  const logs = bars.map(b => Math.log(b.close)), returns = logs.slice(1).map((x, i) => x - logs[i]);
  const origins = [];
  // Non-overlapping target periods; training windows may overlap.
  for (let origin = 252; origin + horizon < bars.length; origin += horizon) origins.push(origin);
  const split = Math.floor(origins.length * .6), tuning = origins.slice(0, split), evaluation = origins.slice(split);
  const enough = tuning.length >= 8 && evaluation.length >= 5;
  let selected = candidates[0];
  const tuningScores = [];
  const run = (candidate, origin) => {
    const samples = simulate(fit(returns.slice(0, origin), candidate), horizon, 512, 4100 + origin).at(-1);
    return score(samples, logs[origin + horizon] - logs[origin]);
  };
  if (enough) {
    for (const candidate of candidates) tuningScores.push({ id: candidate.id, label: candidate.label, score: mean(tuning.map(origin => run(candidate, origin).wis)) });
    const winner = [...tuningScores].sort((a, b) => a.score - b.score)[0];
    if (winner.score < tuningScores[0].score * .95) selected = candidates.find(c => c.id === winner.id);
  }
  const records = enough ? evaluation.map(origin => ({ origin, selected: run(selected, origin), baseline: run(candidates[0], origin) })) : [];
  const aggregate = key => records.length ? Object.fromEntries(['wis', 'error', 'coverage80', 'coverage95', 'brier'].map(metric => [metric, mean(records.map(r => r[key][metric]))])) : null;
  const calibration = Array.from({ length: 5 }, (_, i) => {
    const rows = records.filter(r => Math.min(4, Math.floor(r.selected.probability * 5)) === i);
    return { label: `${i * 20}–${(i + 1) * 20}%`, count: rows.length, predicted: rows.length ? mean(rows.map(r => r.selected.probability)) * 100 : null, observed: rows.length ? mean(rows.map(r => r.selected.outcome)) * 100 : null };
  });
  const simulation = simulate(fit(returns, selected), horizon, 4096, 20261007);
  const calendar = forecastDates(bars.at(-1).time, horizon, options.symbol);
  const last = logs.at(-1), lastClose = bars.at(-1).close;
  const drift = trendDriftPerDay(returns);
  const points = simulation.map((samples, i) => {
    const q = summarize(samples);
    // Headline path follows the 30-session trend; bands keep the
    // volatility-model spreads so uncertainty stays honest.
    const center = last + drift * (i + 1) + q.median;
    const price = offset => Math.exp(center + offset);
    return { date: calendar.dates[i], close: Math.exp(center), lower: price(q.low95 - q.median), upper: price(q.high95 - q.median), lower80: price(q.low80 - q.median), upper80: price(q.high80 - q.median), lower50: price(q.low50 - q.median), upper50: price(q.high50 - q.median) };
  });
  if (points.some(p => Object.entries(p).some(([k, v]) => k !== 'date' && (!Number.isFinite(v) || v <= 0)))) throw new Error('This price series cannot produce a stable projection.');
  const gaps = times.slice(1).filter((t, i) => t - times[i] > 7 * 86400000).length;
  return { points, model: selected.label, modelId: selected.id, version: FORECAST_VERSION, observations: bars.length, trainingWindow: Math.min(returns.length, selected.window), trainedThrough: bars.at(-1).time,
    lastClose, driftPerDay: drift, trend: { driftPerDay: drift, method: '30-session log-price trend, ±1%/day clamp, experimental' },
    change: (points.at(-1).close / lastClose - 1) * 100, samples: simulation.at(-1), calendar: calendar.note,
    quality: gaps ? `${gaps} gaps longer than seven calendar days; interpret results cautiously.` : null,
    evaluation: { count: records.length, tuningCount: enough ? tuning.length : 0, start: records.length ? bars[records[0].origin].time : null, end: records.length ? bars[records.at(-1).origin + horizon].time : null, selected: aggregate('selected'), baseline: aggregate('baseline'), calibration, tuningScores,
      selectionEnd: enough ? bars[tuning.at(-1) + horizon].time : null,
      note: enough ? 'Selection fixed before evaluation. Target periods do not overlap; results can still be statistically dependent.' : 'Insufficient history for separate selection and evaluation. Using the baseline; no accuracy claim.' } };
}
