export const WATCH_LIMIT = 40;
const SYMBOL = /^[A-Z0-9^][A-Z0-9._^=&-]{0,24}$/;

export function cleanSymbols(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(value => typeof value === "string")
    .map(value => value.trim().toUpperCase()).filter(value => SYMBOL.test(value)))].slice(0, WATCH_LIMIT);
}

// A fragment keeps the selected symbols out of server requests. No local records
// or unrelated query parameters are included in the outgoing link.
export function watchlistURL(origin, symbols) {
  const url = new URL("/watchlist", origin);
  const list = cleanSymbols(symbols);
  if (!list.length) throw new Error("Choose at least one stock to share.");
  url.hash = new URLSearchParams({ list: "1", symbols: list.join(",") }).toString();
  return url.href;
}

export function readSharedWatchlist(hash) {
  if (!hash || !/^#?list=/.test(hash)) return null;
  if (hash.length > 2500) return { symbols: [], error: "This shared list is too large. Ask for a new link." };
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const values = (params.get("symbols") || "").split(",");
  if (params.get("list") !== "1" || values.length > WATCH_LIMIT ||
      values.some(value => !SYMBOL.test(value))) {
    return { symbols: [], error: "This shared list could not be read. Ask for a new link." };
  }
  return { symbols: cleanSymbols(values), error: "" };
}

export function mergeWatchlist(current, incoming) {
  const existing = cleanSymbols(current);
  const newSymbols = cleanSymbols(incoming).filter(symbol => !existing.includes(symbol));
  const added = newSymbols.slice(0, Math.max(0, WATCH_LIMIT - existing.length));
  return { symbols: [...existing, ...added], added, overflow: newSymbols.length - added.length };
}

export function watchlistBrief(watch, quotes) {
  const known = watch.map(symbol => ({ symbol, ...quotes[symbol] }))
    .filter(quote => Number.isFinite(quote.change));
  return {
    known: known.length,
    up: known.filter(quote => quote.change > 0).length,
    down: known.filter(quote => quote.change < 0).length,
    flat: known.filter(quote => quote.change === 0).length,
    missing: watch.length - known.length,
    movers: [...known].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 3),
    oldest: known.length && known.every(quote => Number.isFinite(quote.marketTime) && quote.marketTime > 0)
      ? Math.min(...known.map(quote => quote.marketTime)) : null,
  };
}

export function filterWatchlist(watch, quotes, catalog, query, order) {
  const needle = query.trim().toLowerCase();
  const result = watch.filter(symbol => `${symbol} ${catalog.get(symbol)?.name || ""}`.toLowerCase().includes(needle));
  if (order === "name") return result.sort((a, b) => a.localeCompare(b));
  if (!["movers", "gainers", "decliners"].includes(order)) return result;
  return result.sort((a, b) => {
    const x = quotes[a]?.change, y = quotes[b]?.change;
    if (!Number.isFinite(x)) return Number.isFinite(y) ? 1 : 0;
    if (!Number.isFinite(y)) return -1;
    return order === "movers" ? Math.abs(y) - Math.abs(x) : order === "gainers" ? y - x : x - y;
  });
}
