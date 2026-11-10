import { overviewMetrics } from '../src/overviewMetrics.js';
import { PRESETS, runScreen } from '../src/screens.js';
export function buildOverview(screen) {
  const setups = Object.fromEntries(['breakout20', 'pullback', 'accumulation'].map(id => {
    const matches = runScreen(screen.rows, PRESETS.find(preset => preset.id === id))
      .sort((a, b) => (b.turnoverCr || 0) - (a.turnoverCr || 0));
    const fields = ['symbol', 'name', 'price', 'change', 'volRatio', 'delivRatio', 'delivPct', 'rsi'];
    return [id, { count: matches.length, rows: matches.slice(0, 6).map(row => Object.fromEntries(fields.map(key => [key, row[key]]))) }];
  }));
  return { date: screen.date, universe: screen.universe, coverage: screen.coverage,
    metrics: overviewMetrics(screen.rows), setups, source: screen.source, fetchedAt: screen.fetchedAt };
}
