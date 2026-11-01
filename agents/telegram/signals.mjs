import { ema, rsi } from '../../src/marketMath.js';

export const RULES = Object.freeze({ minAdvCr: 100, advSessions: 20, rsiPeriod: 14, pivotWidth: 3, pivotLookback: 60, minRsiGap: 3, minPriceGap: 0.005, breakoutSessions: 20, minVolumeRatio: 1.5, minBreakoutRsi: 60 });
const mean = xs => xs.reduce((sum, x) => sum + x, 0) / xs.length;

// NSE publishes turnover in lakhs; 100 lakhs = one crore. Never substitute
// today's turnover, share volume or an incomplete baseline for traded value.
export function averageTurnoverCr(sessions, symbol, sessionDate) {
  const prior = sessions.filter(s => s.date < sessionDate).sort((a, b) => b.date.localeCompare(a.date)).slice(0, RULES.advSessions);
  if (prior.length !== RULES.advSessions || new Set(prior.map(s => s.date)).size !== RULES.advSessions) return null;
  const values = prior.map(s => s.rows.get(symbol)?.turnover);
  return values.every(v => Number.isFinite(v) && v >= 0) ? mean(values) / 100 : null;
}

export function validDailyBars(bars) {
  return Array.isArray(bars) && bars.every((b, i) => /^\d{4}-\d{2}-\d{2}$/.test(b.time) &&
    [b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite) && b.low > 0 && b.volume >= 0 &&
    b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close) && (!i || b.time > bars[i - 1].time));
}

// A pivot becomes visible only after three subsequent completed candles. Fire
// on that confirmation date, never backdate a signal to the pivot itself.
export function divergences(bars, strength = rsi(bars.map(b => b.close), RULES.rsiPeriod)) {
  const width = RULES.pivotWidth, right = bars.length - 1 - width;
  if (right < RULES.rsiPeriod + width) return [];
  const out = [];
  for (const [field, direction, label] of [['low', 'bullish', 'Bullish RSI divergence'], ['high', 'bearish', 'Bearish RSI divergence']]) {
    const pivot = i => Number.isFinite(strength[i]) && bars.slice(i - width, i + width + 1).every((b, j) =>
      j === width || (field === 'low' ? bars[i].low < b.low : bars[i].high > b.high));
    if (!pivot(right)) continue;
    let left = right - width * 2;
    while (left >= Math.max(RULES.rsiPeriod, right - RULES.pivotLookback) && !pivot(left)) left--;
    if (left < Math.max(RULES.rsiPeriod, right - RULES.pivotLookback)) continue;
    const priceChange = bars[right][field] / bars[left][field] - 1, gap = strength[right] - strength[left];
    if ((direction === 'bullish' && priceChange <= -RULES.minPriceGap && gap >= RULES.minRsiGap) ||
        (direction === 'bearish' && priceChange >= RULES.minPriceGap && gap <= -RULES.minRsiGap)) {
      out.push({ kind: `rsi-${direction}`, label, direction, pivotDate: bars[right].time,
        detail: `${bars[left].time} → ${bars[right].time}: ${field} ₹${bars[left][field].toFixed(2)} → ₹${bars[right][field].toFixed(2)}, RSI ${strength[left].toFixed(1)} → ${strength[right].toFixed(1)}; confirmed ${bars.at(-1).time}` });
    }
  }
  return out;
}

export function evaluateSignals({ symbol, bars, advCr, sessionDate }) {
  if (!Number.isFinite(advCr) || advCr < RULES.minAdvCr || !validDailyBars(bars) || bars.length < 51 || bars.at(-1).time !== sessionDate) return [];
  const current = bars.at(-1), closes = bars.map(b => b.close), strength = rsi(closes), prior20 = bars.slice(-21, -1);
  const high20 = Math.max(...prior20.map(b => b.high)), volume20 = mean(prior20.map(b => b.volume));
  const volumeRatio = volume20 > 0 ? current.volume / volume20 : 0;
  const out = divergences(bars, strength);
  if (current.close > high20 && volumeRatio >= RULES.minVolumeRatio && strength.at(-1) >= RULES.minBreakoutRsi && current.close > ema(closes, 50).at(-1)) {
    out.push({ kind: 'momentum-breakout', label: 'Momentum breakout', direction: 'bullish',
      detail: `Close ₹${current.close.toFixed(2)} > prior 20-session high ₹${high20.toFixed(2)} · volume ${volumeRatio.toFixed(2)}× · RSI ${strength.at(-1).toFixed(1)} · above EMA 50` });
  }
  const cutoff = new Date(`${sessionDate}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 364);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const year = bars.filter(b => b.time >= cutoffDate && b.time < sessionDate);
  // Require a full calendar 52 weeks of coverage, including pre-window data.
  if (bars[0].time <= cutoffDate && year.length >= 200) {
    const high = Math.max(...year.map(b => b.high)), low = Math.min(...year.map(b => b.low));
    if (current.high > high) out.push({ kind: '52-week-high', label: 'New 52-week high', direction: 'bullish', detail: `Session high ₹${current.high.toFixed(2)} > prior 52-week high ₹${high.toFixed(2)}` });
    if (current.low < low) out.push({ kind: '52-week-low', label: 'New 52-week low', direction: 'bearish', detail: `Session low ₹${current.low.toFixed(2)} < prior 52-week low ₹${low.toFixed(2)}` });
  }
  return out.map(s => ({ ...s, symbol, date: sessionDate, close: current.close, advCr,
    id: `${sessionDate}:${symbol}:${s.kind}:${s.pivotDate || sessionDate}` }));
}

export function formatSignal(s) {
  const escape = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const icon = s.kind.startsWith('rsi-') ? '🔎' : s.kind === 'momentum-breakout' ? '🚀' : s.kind === '52-week-high' ? '📈' : '📉';
  return `${icon} <b>${escape(s.symbol.replace(/\.NS$/, ''))} · ${s.label}</b>\n${s.direction === 'bullish' ? '🟢 Bullish' : '🔴 Bearish'} · Close <b>₹${s.close.toFixed(2)}</b>\n${escape(s.detail)}\n💧 20-day avg traded value: <b>₹${s.advCr.toFixed(1)} Cr</b>`;
}

export function freshReport(report, now = new Date()) {
  const age = now - new Date(`${report?.date}T15:30:00+05:30`);
  return Number.isFinite(age) && age >= 0 && age <= 4 * 86400_000;
}
