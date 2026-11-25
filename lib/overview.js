import { overviewMetrics } from '../src/overviewMetrics.js';
import { PRESETS, runScreen } from '../src/screens.js';

function setupLevels(row, id) {
  const pivot = id === 'breakout20' ? row.prior20High : row.sessionHigh;
  if (!Number.isFinite(pivot) || pivot <= 0) return null;
  const risk = row.meanTrueRange14;
  if (!Number.isFinite(risk) || risk <= 0 || risk >= pivot) return { pivot };
  return { pivot, stop: Math.round((pivot - risk) * 100) / 100, target: Math.round((pivot + 2 * risk) * 100) / 100 };
}

export function buildOverview(screen) {
  const setups = Object.fromEntries(['breakout20', 'pullback', 'accumulation'].map(id => {
    const matches = runScreen(screen.rows, PRESETS.find(preset => preset.id === id))
      .sort((a, b) => (b.turnoverCr || 0) - (a.turnoverCr || 0));
    const fields = ['symbol', 'name', 'price', 'change', 'volRatio', 'delivRatio', 'delivPct', 'rsi'];
    const rows = matches.slice(0, 6).map(row => ({
      ...Object.fromEntries(fields.map(key => [key, row[key]])),
      levels: setupLevels(row, id),
    }));
    return [id, { count: matches.length, rows }];
  }));
  return { date: screen.date, universe: screen.universe, coverage: screen.coverage,
    metrics: overviewMetrics(screen.rows), setups, source: screen.source, fetchedAt: screen.fetchedAt };
}
