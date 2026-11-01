// Forecast v4: shared live/backtest construction, point-error selection and rolling validation.
// Experimental context features are evaluated offline before any production promotion.
import { forecastDates } from './forecastCalendar.js';
import { returnFeatures, solveLinear, fitRidgeRows, fitDirectMean } from './forecastRegression.js';

export const FORECAST_VERSION = '4.0.0';

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const quantile = (xs, p) => { const x = (xs.length - 1) * p, i = Math.floor(x); return xs[i] + (xs[Math.min(i + 1, xs.length - 1)] - xs[i]) * (x - i); };

const candidates = [
  { id: 'baseline', label: 'Random walk · constant volatility', window: 252, type: 'constant' },
  { id: 'ewma', label: 'Random walk · adaptive volatility', window: 252, type: 'ewma' },
  { id: 'garch', label: 'GARCH(1,1) · Student-t', window: 504, type: 'garch' },
  { id: 'garch-drift', label: 'Regularized drift · GARCH Student-t', window: 504, type: 'garch', drift: true },
  { id: 'har', label: 'HAR volatility · Student-t', window: 504, type: 'har' },
  { id: 'har-trend', label: 'HAR volatility · Ridge momentum', window: 504, type: 'har-trend' },
  { id: 'trend-30', label: '30-session trend · adaptive volatility', window: 252, type: 'ewma', trend: true },
  { id: 'ridge-direct', label: 'Direct horizon ridge · adaptive volatility', window: 504, type: 'ewma', direct: true },
  { id: 'ridge-context', label: 'Direct horizon ridge · market, sector and volume', window: 504, type: 'ewma', direct: true, context: true },
];

// ---------------------------------------------------------------------------
// A 30-session trend is an explicit candidate, scored like every other model.
// It is never added on top of another model's prediction.
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
export function fitRidgeMean(returns) {
  const rows = [];
  for (let i = 20; i < returns.length; i++) rows.push({ x: returnFeatures(returns, i), y: returns[i] });
  if (rows.length < 30) return { predict: () => 0, residuals: returns.slice() };
  const model = fitRidgeRows(rows);
  return { predict: history => model.predict(returnFeatures(history)), residuals: model.residuals };
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

function fit(returns, candidate, { bars, horizon, context } = {}) {
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
  const direct = candidate.direct ? fitDirectMean(bars.slice(-(candidate.window + 1)), horizon, candidate.context ? context || {} : null) : null;
  const drift = direct ? Math.max(-MEAN_CLAMP, Math.min(MEAN_CLAMP, direct.prediction / horizon))
    : candidate.trend ? trendDriftPerDay(xs)
    : candidate.drift ? Math.max(-Math.sqrt(variance / xs.length), Math.min(Math.sqrt(variance / xs.length), average * .2)) : 0;
  const residuals = xs.map(x => x - drift);
  if (candidate.type === 'constant') return { variance, drift, alpha: 0, beta: 1, omega: 0, student: false };
  if (candidate.type === 'ewma') {
    let v = variance;
    for (const r of residuals) v = .94 * v + .06 * r * r;
    return { variance: v, drift, alpha: .06, beta: .94, omega: 0, student: false, available: direct?.available ?? true };
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

function simulate(model, horizon, count, seed, terminalOnly = false) {
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
        if (!terminalOnly || h === horizon - 1) steps[h].push(totalA, totalB);
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
      if (!terminalOnly || h === horizon - 1) steps[h].push(model.drift * (h + 1) + log, model.drift * (h + 1) - log);
      v = model.omega + model.alpha * r * r + model.beta * v;
    }
  }
  return steps.map(xs => xs.sort((a, b) => a - b));
}

function summarize(samples) {
  return { median: quantile(samples, .5), low50: quantile(samples, .25), high50: quantile(samples, .75), low80: quantile(samples, .1), high80: quantile(samples, .9), low95: quantile(samples, .025), high95: quantile(samples, .975) };
}

const direction = value => Math.abs(Math.expm1(value)) <= .0005 ? 0 : Math.sign(value);

export function scoreForecast(samples, actual) {
  const q = summarize(samples);
  const interval = (l, u, alpha) => u - l + 2 / alpha * Math.max(0, l - actual, actual - u);
  const probability = samples.filter(x => x > 0).length / samples.length;
  return {
    // Weighted interval score in log-return units, rewards calibration AND sharpness.
    wis: (.5 * Math.abs(q.median - actual) + .1 * interval(q.low80, q.high80, .2) + .025 * interval(q.low95, q.high95, .05)) / 2.5,
    error: Math.abs(q.median - actual) * 100,
    returnMae: Math.abs(Math.expm1(q.median) - Math.expm1(actual)) * 100,
    squaredReturnError: ((Math.expm1(q.median) - Math.expm1(actual)) * 100) ** 2,
    directionHit: Number(direction(q.median) === direction(actual)),
    directionCalled: Number(direction(q.median) !== 0),
    calledDirectionHit: Number(direction(q.median) !== 0 && direction(q.median) === direction(actual)),
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

// The objective and gates are fixed before the locked benchmark is opened.
// Directional forecasts must improve point error by 5% while preserving WIS;
// uncertainty-only changes may win on WIS when their point error ties baseline.
export function selectForecastCandidate(scores) {
  const baseline = scores.find(row => row.id === 'baseline');
  let selected = baseline;
  const uncertainty = scores.filter(row => row.available !== false && Number.isFinite(row.wis) && Math.abs(row.returnMae - baseline.returnMae) <= 1e-10)
    .sort((a, b) => a.wis - b.wis)[0];
  if (uncertainty && uncertainty.wis < baseline.wis * .95) selected = uncertainty;
  const winner = scores.filter(row => row.available !== false && Number.isFinite(row.returnMae) && row.wis <= baseline.wis * 1.05)
    .sort((a, b) => a.returnMae - b.returnMae || a.wis - b.wis)[0];
  if (winner && winner.returnMae < baseline.returnMae * .95) selected = winner;
  return selected.id;
}

export function aggregateForecastScores(rows) {
  if (!rows.length) return null;
  const metrics = Object.fromEntries(['wis', 'error', 'returnMae', 'coverage80', 'coverage95', 'brier'].map(metric => [metric, mean(rows.map(r => r[metric]))]));
  const calls = rows.reduce((n, r) => n + r.directionCalled, 0);
  return { ...metrics, returnRmse: Math.sqrt(mean(rows.map(r => r.squaredReturnError))),
    directionAccuracy: mean(rows.map(r => r.directionHit)) * 100,
    directionalCoverage: calls / rows.length * 100,
    directionalAccuracyWhenCalled: calls ? rows.reduce((n, r) => n + r.calledDirectionHit, 0) / calls * 100 : null };
}

export function projectForecast(bars, horizon = 10, options = {}) {
  if (![5, 10, 20, 30].includes(horizon)) throw new Error('Choose a supported forecast horizon.');
  if (!Array.isArray(bars) || bars.length < 70 || bars.some(b => !Number.isFinite(b.close) || b.close <= 0)) throw new Error('At least 70 valid daily prices are needed for a forecast.');
  const times = bars.map(b => typeof b.time === 'number' ? b.time * 1000 : Date.parse(`${b.time}T12:00:00Z`));
  if (times.some((t, i) => !Number.isFinite(t) || (i && t <= times[i - 1]))) throw new Error('History must contain unique, chronological daily sessions.');
  const logs = bars.map(b => Math.log(b.close)), returns = logs.slice(1).map((x, i) => x - logs[i]);
  // Development assessment found no incremental gain from the new mean
  // candidates. They remain opt-in research paths, not production defaults.
  const family = candidates.filter(c => (!c.context || options.experimentalContext)
    && (!c.trend && !c.direct || options.experimentalMeans || options.experimentalContext || options.candidateIds?.includes(c.id) || options.candidateId === c.id)
    && (!options.candidateIds || options.candidateIds.includes(c.id)));
  if (!family.some(c => c.id === 'baseline')) throw new Error('Forecast candidates must include the baseline.');
  const origins = [];
  for (let origin = 252; origin + horizon < bars.length; origin += horizon) origins.push(origin);
  const split = Math.floor(origins.length * .6), evaluationOrigins = origins.slice(split);
  const enough = split >= 8 && evaluationOrigins.length >= 5;
  const cache = new Map();
  const run = (candidate, origin) => {
    const key = `${candidate.id}:${origin}`;
    if (!cache.has(key)) {
      const model = fit(returns.slice(0, origin), candidate, { bars: bars.slice(0, origin + 1), horizon, context: options.context });
      const samples = simulate(model, horizon, 512, 4100 + origin, true).at(-1);
      cache.set(key, { ...scoreForecast(samples, logs[origin + horizon] - logs[origin]), available: model.available !== false });
    }
    return cache.get(key);
  };
  const selectAt = origin => {
    // A historical target is eligible only once its closing price was known.
    const matured = origins.filter(t => t + horizon <= origin), prior = matured.slice(-32);
    if (matured.length < 14) return { candidate: family[0], scores: [], prior };
    const scores = family.map(candidate => ({ id: candidate.id, label: candidate.label,
      ...aggregateForecastScores(prior.map(t => run(candidate, t))),
      available: prior.every(t => run(candidate, t).available),
      score: mean(prior.map(t => run(candidate, t).returnMae)) }));
    const id = selectForecastCandidate(scores);
    let candidate = family.find(c => c.id === id);
    if (candidate.direct && !fit(returns.slice(0, origin), candidate, { bars: bars.slice(0, origin + 1), horizon, context: options.context }).available) candidate = family[0];
    return { candidate, scores, prior };
  };
  const forced = options.candidateId && family.find(c => c.id === options.candidateId);
  if (options.candidateId && !forced) throw new Error('Unknown forecast candidate.');
  const selection = forced ? { candidate: forced, scores: [], prior: [] } : selectAt(bars.length - 1);
  const selected = selection.candidate;
  const records = enough && options.includeEvaluation !== false ? evaluationOrigins.map(origin => {
    const historical = selectAt(origin);
    return { origin, date: bars[origin].time, selectionEnd: historical.prior.length ? bars[historical.prior.at(-1) + horizon].time : null,
      modelId: historical.candidate.id, selected: run(historical.candidate, origin), baseline: run(family[0], origin) };
  }) : [];
  const aggregate = key => aggregateForecastScores(records.map(r => r[key]));
  const calibration = Array.from({ length: 5 }, (_, i) => {
    const rows = records.filter(r => Math.min(4, Math.floor(r.selected.probability * 5)) === i);
    return { label: `${i * 20}–${(i + 1) * 20}%`, count: rows.length, predicted: rows.length ? mean(rows.map(r => r.selected.probability)) * 100 : null, observed: rows.length ? mean(rows.map(r => r.selected.outcome)) * 100 : null };
  });
  const model = fit(returns, selected, { bars, horizon, context: options.context });
  const simulation = simulate(model, horizon, 4096, 20261007);
  const calendar = forecastDates(bars.at(-1).time, horizon, options.symbol);
  const last = logs.at(-1), lastClose = bars.at(-1).close;
  const points = simulation.map((samples, i) => {
    const q = summarize(samples), price = value => Math.exp(last + value);
    return { date: calendar.dates[i], close: price(q.median), lower: price(q.low95), upper: price(q.high95),
      lower80: price(q.low80), upper80: price(q.high80), lower50: price(q.low50), upper50: price(q.high50) };
  });
  if (points.some(p => Object.entries(p).some(([k, v]) => k !== 'date' && (!Number.isFinite(v) || v <= 0)))) throw new Error('This price series cannot produce a stable projection.');
  const gaps = times.slice(1).filter((t, i) => t - times[i] > 7 * 86400000).length;
  const drift = Math.log(points.at(-1).close / lastClose) / horizon;
  return { points, model: selected.label, modelId: selected.id, modelAvailable: model.available !== false, version: FORECAST_VERSION, observations: bars.length,
    trainingWindow: Math.min(returns.length, selected.window), trainedThrough: bars.at(-1).time,
    lastClose, driftPerDay: drift, trend: { driftPerDay: drift, method: 'Selected model median; identical forecast construction in historical evaluation and live output' },
    change: (points.at(-1).close / lastClose - 1) * 100, samples: simulation.at(-1), calendar: calendar.note,
    quality: gaps ? `${gaps} gaps longer than seven calendar days; interpret results cautiously.` : null,
    evaluation: { count: records.length, tuningCount: selection.prior.length, start: records.length ? bars[records[0].origin].time : null,
      end: records.length ? bars[records.at(-1).origin + horizon].time : null, selected: aggregate('selected'), baseline: aggregate('baseline'),
      calibration, tuningScores: selection.scores, records,
      selectionEnd: selection.prior.length ? bars[selection.prior.at(-1) + horizon].time : null,
      note: enough ? 'Rolling model selection uses only previously completed targets at each origin. Target periods do not overlap; results can still be statistically dependent.' : 'Insufficient history for separate selection and evaluation. Using the baseline; no accuracy claim.' } };
}
