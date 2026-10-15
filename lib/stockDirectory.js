import { stockDirectory, stockDirectoryUpdatedAt } from '../src/stocks.js';
import { stockSources, parseStockCSV, mergeStockLists } from '../src/stockCatalog.js';
import { NSE_HEADERS } from './nse.js';

const TTL = 6 * 3600e3;
const RETRY = 60e3;

export function createStockDirectoryLoader({ request = (...args) => fetch(...args), now = Date.now, fallback = stockDirectory, updatedAt = stockDirectoryUpdatedAt } = {}) {
  let cached = null, retryAt = 0, pending = null;
  return async function loadDirectory() {
    const time = now();
    if (cached && time - cached.at < TTL) return cached.data;
    const stale = () => ({
      stocks: cached?.data.stocks || fallback,
      fetchedAt: cached?.data.fetchedAt || updatedAt,
      source: cached ? 'NSE (cached)' : 'Bundled NSE directory',
      stale: true,
    });
    if (time < retryAt) return stale();
    if (pending) return pending;
    pending = (async () => {
      try {
        const lists = await Promise.all(stockSources.map(async source => {
          const response = await request(source.url, { headers: NSE_HEADERS, signal: AbortSignal.timeout(10000) });
          if (!response.ok) throw new Error('NSE directory unavailable');
          const stocks = parseStockCSV(await response.text());
          if (stocks.length < source.minRows) throw new Error('Incomplete NSE directory');
          return stocks;
        }));
        const data = { stocks: mergeStockLists(fallback, ...lists), fetchedAt: new Date(now()).toISOString(), source: 'NSE mainboard + SME', stale: false };
        cached = { at: now(), data };
        return data;
      } catch {
        retryAt = now() + RETRY;
        return stale();
      } finally {
        pending = null;
      }
    })();
    return pending;
  };
}

export const loadStockDirectory = createStockDirectoryLoader();
