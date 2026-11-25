import { PRESETS, runScreen } from './screens.js';
import { PRO_EXAMPLE_SYMBOL } from '../lib/proPlan.js';

const BREAKOUT = PRESETS.find(preset => preset.id === 'breakout20');

// Confirmed breakouts in the home page's Setup watch order: highest average turnover first.
export function rankedBreakouts(rows) {
  return runScreen(rows, BREAKOUT).sort((a, b) => (b.turnoverCr || 0) - (a.turnoverCr || 0));
}

// The one live example a reader without Pro sees in a locked workspace.
// `symbol` is the stock the reader came with; `screen` is the op=screen feed, used by Breakout insights only.
// `requested` is set when that stock is a different one the workspace would cover with Pro.
// `none` means there is nothing to show (no confirmed breakouts, or no data), so the paywall stands in.
export function proExample(page, symbol, screen) {
  if (page === 'Forecast' || page === 'Analytics')
    return { ready: true, symbol: PRO_EXAMPLE_SYMBOL, requested: symbol && symbol !== PRO_EXAMPLE_SYMBOL ? symbol : null };
  if (page !== 'Breakouts') return { ready: true };
  if (!screen?.data) return screen?.loading ? { ready: false } : { ready: true, none: true };
  const ranked = rankedBreakouts(screen.data.rows).map(row => `${row.symbol}.NS`);
  if (!ranked.length) return { ready: true, none: true };
  return { ready: true, symbol: ranked[0], requested: symbol !== ranked[0] && ranked.includes(symbol) ? symbol : null };
}
