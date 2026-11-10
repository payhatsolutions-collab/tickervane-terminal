import { readFileSync } from 'node:fs';
import { recentSessions } from './nse.js';
let snapshot = {};
try { snapshot = JSON.parse(readFileSync(new URL('../content/nse-history.json', import.meta.url), 'utf8')); } catch {}

export function candlesFromSessions(sessions, symbol) {
  const bare = symbol.replace(/\.NS$/, '');
  const bars = sessions.flatMap(session => {
    const row = session.rows.get(bare);
    if (!row || ![row.open, row.high, row.low, row.close].every(Number.isFinite) || row.open <= 0) return [];
    return [{ time: session.date, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.qty }];
  });
  return [...new Map(bars.map(bar => [bar.time, bar])).values()].sort((a, b) => a.time.localeCompare(b.time));
}
export async function nseHistory(symbol, requestedRange) {
  let bars = snapshot[symbol] || [];
  try {
    if (bars.length) return formatHistory(symbol, requestedRange, bars);
    const live = candlesFromSessions(await recentSessions(21), symbol);
    bars = [...new Map([...bars, ...live].map(bar => [bar.time, bar])).values()].sort((a,b) => a.time.localeCompare(b.time));
  } catch {}
  if (!bars.length) throw new Error('NSE history unavailable');
  return formatHistory(symbol, requestedRange, bars);
}
function formatHistory(symbol, requestedRange, bars) {
  bars = [...new Map(bars.map(bar => [bar.time, bar])).values()].sort((a, b) => a.time.localeCompare(b.time));
  const last = bars.at(-1), previous = bars.at(-2)?.close;
  return { symbol, name: symbol.replace(/\.NS$/, ''), currency: 'INR', exchange: 'NSE', timezone: 'Asia/Kolkata',
    price: last.close, previous, change: previous ? (last.close / previous - 1) * 100 : null,
    bars, range: requestedRange, interval: '1d', fallback: true, stale: true, partial: true, asOf: last.time,
    source: 'NSE bhavcopy (last available daily candles)', fetchedAt: new Date().toISOString() };
}
