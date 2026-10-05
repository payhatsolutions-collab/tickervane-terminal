export const SCREEN_CHART_RANGES = { '1M': 22, '3M': 64, '1Y': 252 };

/** Draw real OHLC bars; never infer candles from closing prices. */
export function screenChart(bars, range = '3M', width = 176, height = 76) {
  const daily = (Array.isArray(bars) ? bars : []).filter(b =>
    b && typeof b.time === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.time) &&
    ['open', 'high', 'low', 'close'].every(k => Number.isFinite(b[k]) && b[k] > 0) &&
    b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close)
  ).slice(-(SCREEN_CHART_RANGES[range] || SCREEN_CHART_RANGES['3M']));
  if (!daily.length) return null;
  // Weekly OHLC keeps a full year legible in a thumbnail. Group by calendar week.
  const weeks = new Map();
  if (range === '1Y') for (const b of daily) {
    const date = new Date(`${b.time}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const key = date.toISOString().slice(0, 10), previous = weeks.get(key);
    weeks.set(key, previous ? { ...previous, high: Math.max(previous.high, b.high), low: Math.min(previous.low, b.low), close: b.close, end: b.time } : { ...b, end: b.time });
  }
  const candles = range === '1Y' ? [...weeks.values()] : daily;
  const low = Math.min(...candles.map(b => b.low)), high = Math.max(...candles.map(b => b.high));
  const spread = high - low;
  const y = value => spread ? height - 6 - (value - low) / spread * (height - 12) : height / 2;
  const step = (width - 12) / candles.length, bodyWidth = Math.max(.8, Math.min(9, step * .65));
  return {
    candles: candles.map((b, i) => ({ ...b, x: 6 + (i + .5) * step, highY: y(b.high), lowY: y(b.low), openY: y(b.open), closeY: y(b.close), bodyY: Math.min(y(b.open), y(b.close)), bodyHeight: Math.max(.8, Math.abs(y(b.open) - y(b.close))), bodyWidth })),
    change: (daily.at(-1).close / daily[0].close - 1) * 100,
    sessions: daily.length, interval: range === '1Y' ? 'Weekly' : 'Daily',
    low, high, from: daily[0].time, to: daily.at(-1).time,
  };
}
