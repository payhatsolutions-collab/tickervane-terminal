// All features end at the forecast origin. Direct targets must finish inside
// the training window; overlapping targets never cross a validation boundary.
export function returnFeatures(history, end = history.length) {
  const lag = k => end - k >= 0 ? history[end - k] : 0;
  let momentum5 = 0, momentum20 = 0, dispersion = 0;
  for (let k = 1; k <= 5; k++) momentum5 += lag(k);
  for (let k = 1; k <= 20; k++) momentum20 += lag(k);
  momentum5 /= 5; momentum20 /= 20;
  for (let k = 1; k <= 20; k++) dispersion += (lag(k) - momentum20) ** 2;
  return [lag(1), lag(2), lag(3), lag(4), lag(5), momentum5, momentum20, Math.sqrt(dispersion / 20)];
}

export function solveLinear(system, rhs) {
  const n = rhs.length, augmented = system.map((row, i) => [...row, rhs[i]]);
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
  return augmented.map((row, i) => Math.abs(row[i]) > 1e-12 ? row[n] / row[i] : 0);
}

export function fitRidgeRows(rows, lambda = 20) {
  if (!rows.length) return null;
  const p = rows[0].x.length, center = Array(p).fill(0), scale = Array(p).fill(0);
  for (const row of rows) for (let j = 0; j < p; j++) center[j] += row.x[j];
  for (let j = 0; j < p; j++) center[j] /= rows.length;
  for (const row of rows) for (let j = 0; j < p; j++) scale[j] += (row.x[j] - center[j]) ** 2;
  for (let j = 0; j < p; j++) { scale[j] = Math.sqrt(scale[j] / rows.length); if (!(scale[j] > 1e-10)) scale[j] = 1; }
  const system = Array.from({ length: p + 1 }, () => Array(p + 1).fill(0)), rhs = Array(p + 1).fill(0);
  for (const row of rows) {
    const x = [...row.x.map((value, j) => (value - center[j]) / scale[j]), 1];
    for (let a = 0; a <= p; a++) {
      rhs[a] += x[a] * row.y;
      for (let b = 0; b <= p; b++) system[a][b] += x[a] * x[b];
    }
  }
  for (let j = 0; j < p; j++) system[j][j] += lambda;
  const weights = solveLinear(system, rhs);
  const predict = x => weights[p] + x.reduce((value, v, j) => value + weights[j] * (v - center[j]) / scale[j], 0);
  return { predict, residuals: rows.map(row => row.y - predict(row.x)) };
}

const key = time => typeof time === 'number' ? new Date(time * 1000).toISOString().slice(0, 10) : time;

export function fitDirectMean(bars, horizon, context = null) {
  const logs = bars.map(b => Math.log(b.close)), returns = logs.slice(1).map((x, i) => x - logs[i]);
  const factors = context ? ['market', 'sector'].filter(name => Array.isArray(context[name]) && context[name].length) : [];
  const maps = factors.map(name => new Map(context[name].filter(b => Number.isFinite(b.close) && b.close > 0).map(b => [key(b.time), b.close])));
  const features = origin => {
    const x = returnFeatures(returns, origin);
    if (context) {
      const volumes = bars.slice(origin - 20, origin).map(b => b.volume);
      if (!(bars[origin].volume > 0) || volumes.some(v => !(v > 0))) return null;
      const average = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      x.push(Math.log(bars[origin].volume / average));
      for (const map of maps) {
        const current = map.get(key(bars[origin].time));
        for (const lag of [5, 20]) {
          const previous = map.get(key(bars[origin - lag].time));
          if (!(current > 0) || !(previous > 0)) return null;
          const factorReturn = Math.log(current / previous);
          x.push(factorReturn, logs[origin] - logs[origin - lag] - factorReturn);
        }
      }
    }
    return x.every(Number.isFinite) ? x : null;
  };
  const rows = [];
  for (let origin = 20; origin + horizon < bars.length; origin++) {
    const x = features(origin);
    if (x) rows.push({ x, y: logs[origin + horizon] - logs[origin] });
  }
  const latest = bars.length > 20 ? features(bars.length - 1) : null;
  if (rows.length < 60 || !latest) return { available: false, prediction: 0, observations: rows.length };
  // Adjacent h-session targets overlap: increase shrinkage by h instead of
  // treating them as h times as much independent evidence.
  const model = fitRidgeRows(rows, 20 * horizon);
  return { available: true, prediction: model.predict(latest), observations: rows.length,
    trainedThrough: bars.at(-1).time, factors };
}
