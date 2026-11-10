import { useEffect, useRef, useState } from "react";

import { normalizeSymbol, sliceDailyHistory } from './symbols.js';

const memory = new Map(),
  pending = new Map();
export function clearCache() {
  memory.clear();
  pending.clear();
  quoteValues.clear();
}

export function cacheLifetime(url) {
  const params = new URL(url, 'http://localhost').searchParams;
  const op = params.get('op');
  // Historical research refreshes every five minutes; live quotes and
  // intraday charts retain their existing 15-second freshness window.
  return ['quotes', 'options', 'live-futures'].includes(op) ||
    (op === 'chart' && ['1d', '5d'].includes(params.get('range'))) ? 15000 : 300000;
}

export async function load(url, force = false) {
  const parsed = new URL(url, 'http://localhost');
  if (parsed.pathname === '/api/market' && parsed.searchParams.get('op') === 'chart') {
    const symbol = normalizeSymbol(parsed.searchParams.get('symbol'));
    const range = parsed.searchParams.get('range');
    const sharedRange = ['1mo', '3mo', '6mo'].includes(range) ? '1y' : range;
    if (symbol !== parsed.searchParams.get('symbol') || sharedRange !== range) {
      parsed.searchParams.set('symbol', symbol);
      parsed.searchParams.set('range', sharedRange);
      const sharedURL = parsed.pathname + parsed.search;
      const data = sliceDailyHistory(await load(sharedURL, force), range);
      // Retain the derived view too, so a failed refresh can keep the last
      // rendered candles while all ranges still share one upstream request.
      memory.set(url, { data, at: memory.get(sharedURL)?.at || Date.now() });
      return data;
    }
  }
  const cached = memory.get(url);
  if (!force && cached && Date.now() - cached.at < cacheLifetime(url)) return cached.data;
  if (pending.has(url)) return pending.get(url);
  // Timeout so a stalled upstream becomes a retryable error instead of an endless spinner.
  const p = fetch(url, { signal: AbortSignal.timeout?.(30000) })
    .then(async (r) => {
      let j = null;
      try {
        j = await r.json();
      } catch {
        throw Error(`Request failed (${r.status})`);
      }
      if (!r.ok) throw Error(j?.error || `Request failed (${r.status})`);
      if (memory.size > 200) memory.delete(memory.keys().next().value);
      memory.set(url, { data: j, at: Date.now() });
      return j;
    })
    .finally(() => {
      if (pending.get(url) === p) pending.delete(url);
    });
  pending.set(url, p);
  return p;
}

// Only bypass the client cache when `refresh` itself changes (manual or
// 5-minute refresh). Switching symbols reuses cached data when fresh.
// NOTE: no AbortController on the shared fetch — StrictMode double-mount
// would otherwise abort a shared in-flight request for all callers.
export function useFeed(url, refresh = 0) {
  const [state, set] = useState({
    url,
    data: memory.get(url)?.data || null,
    loading: !!url,
    error: null,
  });
  const lastRefresh = useRef(refresh);
  useEffect(() => {
    if (!url) {
      set({ url, data: null, loading: false, error: null });
      return;
    }
    let active = true;
    const shouldForce = refresh !== lastRefresh.current;
    lastRefresh.current = refresh;
    set({
      url,
      data: memory.get(url)?.data || null,
      loading: true,
      error: null,
    });
    load(url, shouldForce)
      .then((data) => {
        if (active) set({ url, data, loading: false, error: null });
      })
      .catch((e) => {
        if (active)
          set({
            url,
            data: memory.get(url)?.data || null,
            loading: false,
            error: e.message,
          });
      });
    return () => {
      active = false;
    };
  }, [url, refresh]);
  // Effects run after rendering; never expose the preceding URL's data.
  return state.url === url
    ? state
    : { url, data: memory.get(url)?.data || null, loading: !!url, error: null };
}

export function useSaved(key, initial, validate = value => value) {
  const [value, set] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return initial;
      const j = validate(JSON.parse(raw));
      if (Array.isArray(initial)) return Array.isArray(j) ? j : initial;
      if (initial && typeof initial === "object")
        return j && typeof j === "object" && !Array.isArray(j) ? j : initial;
      return typeof j === typeof initial ? j : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [value, set];
}

// Refresh only visible tabs; resume immediately when the user returns.
function useQuotePulse() {
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    const tick = () => { if (!document.hidden) setPulse(n => n + 1); };
    const timer = setInterval(tick, 30000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('online', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('online', tick);
    };
  }, []);
  return pulse;
}

const quoteValues = new Map(), quotePending = new Map(), quoteQueue = new Map();
let quoteScheduled = false;
export function loadQuoteSet(symbols, force = false) {
  const now = Date.now();
  const requests = symbols.map(symbol => {
    const hit = quoteValues.get(symbol);
    if (!force && hit && now - hit.at < 15000) return Promise.resolve(hit.data);
    if (quotePending.has(symbol)) return quotePending.get(symbol);
    const request = new Promise((resolve, reject) => quoteQueue.set(symbol, { resolve, reject }));
    quotePending.set(symbol, request);
    return request;
  });
  if (!quoteScheduled && quoteQueue.size) {
    quoteScheduled = true;
    queueMicrotask(() => {
      quoteScheduled = false;
      const entries = [...quoteQueue];
      quoteQueue.clear();
      for (let i = 0; i < entries.length; i += 16) {
        const batch = entries.slice(i, i + 16).sort(([a], [b]) => a.localeCompare(b));
        load('/api/market?op=quotes&symbols=' + encodeURIComponent(batch.map(([symbol]) => symbol).join(',')), force)
          .then(data => {
            for (const [symbol, task] of batch) {
              const quote = data.quotes?.find(quote => quote.symbol === symbol);
              if (quote) { quoteValues.set(symbol, { data: quote, at: Date.now() }); task.resolve(quote); }
              else task.reject(new Error(`Quote unavailable: ${symbol}`));
            }
          }, error => batch.forEach(([, task]) => task.reject(error)))
          .finally(() => batch.forEach(([symbol]) => quotePending.delete(symbol)));
      }
    });
  }
  return Promise.allSettled(requests).then(results => ({
    quotes: results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []),
    errors: results.flatMap((result, i) => result.status === 'rejected' ? [symbols[i]] : []),
  }));
}

export function useQuotes(symbols, refresh = 0) {
  const pulse = useQuotePulse();
  const key = [...new Set((symbols || []).filter(Boolean))].sort().join(",");
  const [state, set] = useState({ quotes: {}, loading: true, error: null });
  const lastRefresh = useRef(refresh);
  useEffect(() => {
    let active = true;
    if (!key) {
      set({ quotes: {}, loading: false, error: null });
      return;
    }
    const shouldForce = refresh !== lastRefresh.current;
    lastRefresh.current = refresh;
    const list = key.split(",");
    set((s) => ({ ...s, loading: true, error: null }));
    loadQuoteSet(list, shouldForce).then((result) => {
      if (!active) return;
      const quotes = Object.fromEntries(result.quotes.map(quote => [quote.symbol, quote]));
      const missing = result.errors;
      if (!active) return;
      set((previous) => ({
        quotes: Object.fromEntries(
          list.flatMap((symbol) => {
            const q = quotes[symbol] || previous.quotes[symbol];
            return q ? [[symbol, q]] : [];
          }),
        ),
        loading: false,
        error: missing.length
          ? "Some quotes could not refresh · previous values retained."
          : null,
      }));
    });
    return () => {
      active = false;
    };
  }, [key, refresh, pulse]);
  return state;
}
