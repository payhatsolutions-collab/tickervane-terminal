import { stockDirectory } from './stocks.js';
import publicStocks from '../content/stock-symbols.json' with { type: 'json' };
const publicStockSet = new Set(publicStocks);
export function stockResearchURL(symbol) {
  const bare = String(symbol || '').replace(/\.NS$/, '');
  return publicStockSet.has(bare) ? '/stocks/' + encodeURIComponent(bare) : null;
}
const nse = new Set(stockDirectory.map(stock => stock.symbol));
// Only recognized NSE tickers get a suffix; global assets retain their exchange.
export function normalizeSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  return nse.has(symbol) ? `${symbol}.NS` : symbol;
}
export function sliceDailyHistory(data, range) {
  const months = { '1mo': 1, '3mo': 3, '6mo': 6 }[range];
  if (!months || !data?.bars?.length) return data;
  const end = new Date(`${data.bars.at(-1).time}T00:00:00Z`);
  if (!Number.isFinite(end.getTime())) return data;
  end.setUTCMonth(end.getUTCMonth() - months);
  const start = end.toISOString().slice(0, 10);
  return { ...data, range, bars: data.bars.filter(bar => bar.time >= start) };
}
