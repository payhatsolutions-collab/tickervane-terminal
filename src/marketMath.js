export function ema(values, period = 50) {
  let previous;
  return values.map((value, i) => {
    if (i < period - 1) return null;
    previous = i === period - 1 ? values.slice(0, period).reduce((a, b) => a + b, 0) / period : value * (2 / (period + 1)) + previous * (1 - 2 / (period + 1));
    return previous;
  });
}

export function bollinger(values, period = 20) {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    const sample = values.slice(i - period + 1, i + 1);
    const middle = sample.reduce((a, b) => a + b, 0) / period;
    const deviation = Math.sqrt(sample.reduce((sum, n) => sum + (n - middle) ** 2, 0) / period);
    return { middle, upper: middle + 2 * deviation, lower: middle - 2 * deviation };
  });
}

export function rsi(values, period = 14) {
  let gain = 0, loss = 0;
  return values.map((value, i) => {
    if (!i) return null;
    const delta = value - values[i - 1];
    if (i <= period) { gain += Math.max(delta, 0) / period; loss += Math.max(-delta, 0) / period; }
    else { gain = (gain * (period - 1) + Math.max(delta, 0)) / period; loss = (loss * (period - 1) + Math.max(-delta, 0)) / period; }
    return i < period ? null : gain === 0 && loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  });
}

/**
 * Indicator-only bullish/mixed/bearish read of daily closes. Five fixed rules over
 * EMA 50, RSI 14 and Bollinger Bands (20, 2) plus 63-day momentum and EMA
 * slope — no price targets, no learning, fully reproducible. Each rule votes
 * +1 (bullish), -1 (bearish) or 0 (neutral); +2 or more reads bullish, -2 or
 * less reads bearish, otherwise mixed. Educational signal, not advice.
 */
export function signalSnapshot(bars) {
  const closes = (bars || []).map(b => b.close);
  if (closes.length < 70 || closes.some(c => !Number.isFinite(c) || c <= 0)) {
    return { verdict: 'Unavailable', score: 0, rules: [], note: 'Needs 70+ daily closes for a full indicator read.' };
  }
  const last = closes.length - 1;
  const close = closes[last];
  const e50 = ema(closes, 50);
  const strength = rsi(closes, 14);
  const bands = bollinger(closes, 20);
  const avg = e50[last], rsiLast = strength[last], band = bands[last];
  const dev = avg == null || avg <= 0 ? null : close / avg - 1;
  const momentum = closes[last] / closes[last - 63] - 1;
  const slopeBase = e50[last - 10];
  const slope = avg == null || slopeBase == null || slopeBase <= 0 ? null : avg / slopeBase - 1;
  const pct = v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
  const rule = (label, reading, bias) => ({ label, reading, bias });
  const rules = [
    rule('EMA 50 trend', dev == null ? '—' : `${pct(dev)} vs EMA 50`, dev == null || Math.abs(dev) < 0.003 ? 0 : dev > 0 ? 1 : -1),
    rule('RSI 14 momentum', rsiLast == null ? '—' : rsiLast.toFixed(1), rsiLast == null ? 0 : rsiLast >= 55 ? 1 : rsiLast <= 45 ? -1 : 0),
    rule('Bollinger 20 position', band == null ? '—' : close > band.middle ? 'Above middle band' : close < band.middle ? 'Below middle band' : 'On middle band', band == null ? 0 : close > band.middle ? 1 : close < band.middle ? -1 : 0),
    rule('63-day momentum', pct(momentum), Math.abs(momentum) < 0.05 ? 0 : momentum > 0 ? 1 : -1),
    rule('EMA 50 slope · 10d', slope == null ? '—' : pct(slope), slope == null || Math.abs(slope) < 0.002 ? 0 : slope > 0 ? 1 : -1),
  ];
  const score = rules.reduce((total, r) => total + r.bias, 0);
  const verdict = score >= 2 ? 'Bullish' : score <= -2 ? 'Bearish' : 'Mixed';
  return { verdict, score, rules, note: 'Five fixed rules on EMA 50, RSI 14 and Bollinger Bands.' };
}

/**
 * Market-regime read of daily closes, shown alongside the indicator signal
 * as in earlier versions. Deterministic, no learning, no price targets:
 * trend from close vs EMA 50 + EMA 50 10-day slope + 63-day momentum,
 * volatility from Bollinger bandwidth (20, 2) ranked against its own
 * 63-bar history. Returns a short label plus the inputs so users can see
 * why. Educational, not advice.
 */
export function marketRegime(bars) {
  const closes = (bars || []).map(b => b.close);
  if (!closes.length) {
    return { label: 'Insufficient data', trend: 'Unknown', volatility: 'Unknown', tone: 'muted', note: 'Needs 70+ daily closes for a regime read.' };
  }
  if (typeof bars[0]?.time !== 'string') {
    return { label: 'Intraday — no regime', trend: 'Unknown', volatility: 'Unknown', tone: 'muted', note: 'Intraday bars — switch to 1M or longer for a daily regime read.' };
  }
  if (closes.length < 70 || closes.some(c => !Number.isFinite(c) || c <= 0)) {
    return { label: 'Insufficient data', trend: 'Unknown', volatility: 'Unknown', tone: 'muted', note: 'Needs 70+ daily closes for a regime read.' };
  }
  const last = closes.length - 1;
  const close = closes[last];
  const e50 = ema(closes, 50);
  const strength = rsi(closes, 14);
  const bands = bollinger(closes, 20);
  const avg = e50[last], rsiLast = strength[last], band = bands[last];
  if (avg == null || band == null || rsiLast == null) {
    return { label: 'Insufficient data', trend: 'Unknown', volatility: 'Unknown', tone: 'muted', note: 'Needs 70+ daily closes for a regime read.' };
  }
  const dev = close / avg - 1;
  const slopeBase = e50[last - 10];
  const slope = slopeBase == null || slopeBase <= 0 ? 0 : avg / slopeBase - 1;
  const momentum = closes[last] / closes[last - 63] - 1;
  const bandwidth = (band.upper - band.lower) / band.middle * 100;
  const history = bands.slice(-64, -1).filter(Boolean).map(b => (b.upper - b.lower) / b.middle * 100).filter(Number.isFinite);
  const rank = history.length ? history.filter(v => v <= bandwidth).length / history.length * 100 : 50;
  const volatility = rank >= 70 || bandwidth >= 25 ? 'Elevated' : rank <= 30 || bandwidth <= 3 ? 'Compressed' : 'Normal';
  let trend;
  if (dev > 0.05 && slope > 0.005) trend = 'Strong uptrend';
  else if (dev > 0.01 && slope > 0) trend = 'Uptrend';
  else if (dev < -0.05 && slope < -0.005) trend = 'Strong downtrend';
  else if (dev < -0.01 && slope < 0) trend = 'Downtrend';
  else if (Math.abs(dev) < 0.03 && Math.abs(momentum) < 0.08) trend = 'Range';
  else trend = slope > 0 ? 'Recovering' : slope < 0 ? 'Weakening' : 'Mixed';
  const tone = trend.includes('uptrend') || trend === 'Recovering' ? 'positive' : trend.includes('downtrend') || trend === 'Weakening' ? 'negative' : 'muted';
  const pct1 = v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
  return {
    label: `${trend} · ${volatility.toLowerCase()} volatility`,
    trend, volatility, tone, bandwidth, bandwidthRank: Math.round(rank),
    detail: `Close ${pct1(dev)} vs EMA 50 · EMA slope ${pct1(slope)}/10d · 63d ${pct1(momentum)} · RSI ${rsiLast.toFixed(0)} · BBW ${bandwidth.toFixed(1)}% (rank ${Math.round(rank)}/100 over 63 bars)`,
    note: 'Trend + volatility regime from daily closes. Research only.',
  };
}

export function projectPrices(bars, horizon = 10) {
  if (![5, 10, 20, 30].includes(horizon)) throw new Error('Choose a supported forecast horizon.');
  const recent = bars.slice(-253);
  if (recent.length < 70 || recent.some(b => !Number.isFinite(b.close) || b.close <= 0)) throw new Error('At least 70 valid daily prices are needed for a forecast.');
  const prices = recent.map(b => b.close);
  const logs = prices.map(Math.log);
  const returns = logs.slice(1).map((v, i) => v - logs[i]);
  const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
  const holdout = Math.min(15, Math.max(5, horizon));
  const trainReturns = returns.slice(0, -holdout);
  const trainEnd = logs[logs.length - holdout - 1];
  const actual = logs.slice(-holdout);
  const trainDrift = mean(trainReturns);
  const error = drift => mean(actual.map((value, i) => (trainEnd + drift * (i + 1) - value) ** 2));
  const useDrift = error(trainDrift) < error(0);
  const holdoutDrift = useDrift ? trainDrift : 0;
  const mape = mean(actual.map((value, i) => Math.abs(Math.exp(trainEnd + holdoutDrift * (i + 1) - value) - 1))) * 100;
  const drift = useDrift ? mean(returns) : 0;
  const average = mean(returns);
  const sigma = Math.sqrt(returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / (returns.length - 1));
  const last = logs.at(-1);
  const lastBar = recent.at(-1);
  const lastTime = lastBar?.time;
  const date = typeof lastTime === 'number'
    ? new Date(lastTime * 1000)
    : new Date(`${lastTime}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new Error('This price series cannot produce a stable projection.');
  const points = Array.from({ length: horizon }, (_, i) => {
    do { date.setUTCDate(date.getUTCDate() + 1); } while ([0, 6].includes(date.getUTCDay()));
    const h = i + 1, center = last + drift * h, width = 1.96 * sigma * Math.sqrt(h);
    return { date: date.toISOString().slice(0, 10), close: Math.exp(center), lower: Math.exp(center - width), upper: Math.exp(center + width) };
  });
  if (points.some(p => ![p.close, p.lower, p.upper].every(Number.isFinite))) throw new Error('This price series cannot produce a stable projection.');
  return { points, model: useDrift ? 'Random walk with drift' : 'Random walk without drift', observations: prices.length, holdout, mape, change: (points.at(-1).close / prices.at(-1) - 1) * 100 };
}

// Session VWAP for intraday bars (unix seconds), reset at each IST calendar date.
export function vwap(bars, timezone = 'Asia/Kolkata') {
  const day = new Intl.DateTimeFormat('en-CA', {timeZone:timezone, year:'numeric', month:'2-digit', day:'2-digit'});
  let key = null, pv = 0, vol = 0;
  return (bars || []).map(b => {
    const k = day.format(new Date(b.time * 1000));
    if (k !== key) { key = k; pv = 0; vol = 0; }
    if (Number.isFinite(b.volume) && b.volume > 0) { pv += (b.high + b.low + b.close) / 3 * b.volume; vol += b.volume; }
    return vol > 0 ? pv / vol : null;
  });
}

// NSE cash-market session from the IST clock. Exchange holidays are not tracked.
export function nseSession(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Kolkata', weekday:'short', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(now).map(x => [x.type, x.value]));
  const m = Number(p.hour) * 60 + Number(p.minute), dur = n => n >= 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n}m`;
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return {state:'closed', label:'NSE closed · weekend'};
  if (m < 540) return {state:'closed', label:`Pre-open in ${dur(540 - m)}`};
  if (m < 555) return {state:'pre', label:`Pre-open · opens in ${dur(555 - m)}`};
  if (m < 930) return {state:'open', label:`NSE open · closes in ${dur(930 - m)}`};
  if (m < 960) return {state:'pre', label:'Closing session'};
  return {state:'closed', label:'NSE closed'};
}

// India VIX regime and Nifty 500 breadth for the market pulse.
export function vixRead(v) {
  if (!Number.isFinite(v)) return { label: 'Unavailable', tone: 'muted', note: '' };
  if (v < 12) return { label: 'Low', tone: 'positive', note: 'Calm tape; option premiums cheap, breakouts can lack follow-through.' };
  if (v < 16) return { label: 'Normal', tone: 'positive', note: 'Typical ranges; standard position sizes.' };
  if (v < 20) return { label: 'Elevated', tone: 'accent', note: 'Wider intraday swings; consider wider stops with smaller size.' };
  return { label: 'High', tone: 'negative', note: 'Fear regime; gaps and whipsaws likely — cut size.' };
}
export function breadth(rows) {
  const r = (rows || []).filter(x => Number.isFinite(x.change));
  if (!r.length) return null;
  const share = f => { const known = r.filter(x => f(x) != null); return known.length ? known.filter(x => f(x)).length / known.length * 100 : null; };
  const adv = r.filter(x => x.change > 0).length, dec = r.filter(x => x.change < 0).length;
  return { n: r.length, adv, dec, ratio: dec ? adv / dec : null, above50: share(x => x.above50), above200: share(x => x.above200),
    nearHigh: r.filter(x => Number.isFinite(x.fromHigh) && x.fromHigh >= -1).length, nearLow: r.filter(x => Number.isFinite(x.fromLow) && x.fromLow <= 1).length };
}
