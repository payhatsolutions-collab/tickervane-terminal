const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const cleanHistory = input => [...new Map(input.filter(b => /^\d{4}-\d{2}-\d{2}$/.test(b.time) && Number.isFinite(b.close) && b.close > 0).map(b => [b.time, b])).values()].sort((a, b) => a.time.localeCompare(b.time));
export const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : null;
};

export function screenAnalytics(rows = []) {
  const known = rows.filter(r => typeof r.above200 === 'boolean');
  const sectors = [...new Set(rows.map(r => r.industry || 'Unclassified'))].map(industry => {
    const members = rows.filter(r => (r.industry || 'Unclassified') === industry);
    return { industry, count: members.length, return3m: median(members.map(r => r.r3m)), coverage: members.filter(r => Number.isFinite(r.r3m)).length };
  }).sort((a, b) => b.count - a.count);
  return { total: rows.length, medianRS: median(rows.map(r => r.rs3m)), medianVolume: median(rows.map(r => r.volRatio)),
    trendPercent: known.length ? known.filter(r => r.above200).length / known.length * 100 : null,
    trendKnown: known.length, sectors };
}

// Adjusted completed daily closes only. Returns are paired by BOTH session dates
// so gaps in either series cannot silently create mismatched beta observations.
export function historyAnalytics(bars = [], benchmark = []) {
  const series = cleanHistory(bars), bench = cleanHistory(benchmark);
  const returns = input => input.slice(1).map((b, i) => ({ key: `${input[i].time}/${b.time}`, value: b.close / input[i].close - 1 }));
  const daily = returns(series), values = daily.map(r => r.value);
  const average = mean(values);
  const variance = values.length > 1 ? values.reduce((sum, r) => sum + (r - average) ** 2, 0) / (values.length - 1) : null;
  let peak = series[0]?.close, drawdown = 0;
  for (const bar of series) { peak = Math.max(peak, bar.close); drawdown = Math.min(drawdown, bar.close / peak - 1); }
  const reference = new Map(returns(bench).map(r => [r.key, r.value]));
  const pairs = daily.filter(r => reference.has(r.key)).map(r => [r.value, reference.get(r.key)]);
  const x = mean(pairs.map(p => p[0])), y = mean(pairs.map(p => p[1]));
  const covariance = pairs.reduce((sum, p) => sum + (p[0] - x) * (p[1] - y), 0);
  const stockVariance = pairs.reduce((sum, p) => sum + (p[0] - x) ** 2, 0);
  const benchVariance = pairs.reduce((sum, p) => sum + (p[1] - y) ** 2, 0);
  const sufficient = values.length >= 20;
  return { sessions: series.length, from: series[0]?.time, to: series.at(-1)?.time, pairs: pairs.length,
    totalReturn: series.length > 1 ? (series.at(-1).close / series[0].close - 1) * 100 : null,
    maxDrawdown: series.length > 1 ? drawdown * 100 : null,
    volatility: sufficient && variance !== null ? Math.sqrt(variance * 252) * 100 : null,
    sharpe: sufficient && variance > 0 ? average / Math.sqrt(variance) * Math.sqrt(252) : null,
    beta: pairs.length >= 20 && benchVariance > 0 ? covariance / benchVariance : null,
    correlation: pairs.length >= 20 && benchVariance > 0 && stockVariance > 0 ? Math.max(-1, Math.min(1, covariance / Math.sqrt(stockVariance * benchVariance))) : null,
  };
}

// Compare both instruments from the same starting close on shared dates.
// Drawdown retains the stock's full history, including unmatched sessions.
export function historySeries(bars = [], benchmark = []) {
  const stock = cleanHistory(bars), reference = new Map(cleanHistory(benchmark).map(bar => [bar.time, bar.close]));
  const aligned = stock.filter(bar => reference.has(bar.time));
  const benchmarkAligned = aligned.length >= 2;
  const compared = benchmarkAligned ? aligned : stock;
  const first = compared[0];
  let peak = stock[0]?.close;
  return {
    benchmarkAligned,
    performance: compared.map(bar => ({ time: bar.time, value: (bar.close / first.close - 1) * 100,
      benchmark: benchmarkAligned ? (reference.get(bar.time) / reference.get(first.time) - 1) * 100 : null })),
    drawdown: stock.map(bar => {
      peak = Math.max(peak, bar.close);
      return { time: bar.time, value: (bar.close / peak - 1) * 100 };
    }),
  };
}

export function breakoutInsight(row) {
  const confirmed = row.breakout20 === true && Number.isFinite(row.volRatio) && row.volRatio >= 1.3;
  const observations = [
    row.breakout20 === true ? 'The session close exceeded the prior 20-session high.' : 'The latest snapshot does not confirm a 20-session breakout.',
    Number.isFinite(row.volRatio) ? `Session volume was ${row.volRatio.toFixed(2)}× its 20-session average${row.volRatio >= 1.3 ? ', meeting the screen’s 1.3× confirmation threshold.' : ', below the screen’s 1.3× confirmation threshold.'}` : 'Volume confirmation is unavailable.',
    Number.isFinite(row.rs3m) ? `Over three months, the stock ${row.rs3m >= 0 ? 'outperformed' : 'underperformed'} Nifty 50 by ${Math.abs(row.rs3m).toFixed(2)} percentage points.` : 'Three-month relative strength is unavailable.',
  ];
  const cautions = ['A close back inside the prior range can invalidate a breakout. Review the chart before setting a price alert.'];
  if (Number.isFinite(row.rsi) && row.rsi >= 70) cautions.push(`RSI is ${row.rsi.toFixed(1)}: momentum is elevated and the move may be extended.`);
  if (row.above200 === false) cautions.push('The stock remains below its 200-day moving average. Long-term trend confirmation is absent.');
  if (Number.isFinite(row.rs3m) && row.rs3m < 0) cautions.push('The stock has lagged Nifty 50 over three months despite its recent move.');
  return { confirmed, observations, cautions };
}
