import { useEffect, useRef, useState } from "react";

const memory = new Map(),
  pending = new Map();
export function clearCache() {
  memory.clear();
  pending.clear();
}

export async function load(url, force = false) {
  const cached = memory.get(url);
  if (!force && cached && Date.now() - cached.at < (/op=(quotes|chart|options|live-futures)\b/.test(url) ? 15000 : 300000)) return cached.data;
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

export function useSaved(key, initial) {
  const [value, set] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return initial;
      const j = JSON.parse(raw);
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
    Promise.allSettled(
      Array.from({ length: Math.ceil(list.length / 16) }, (_, i) =>
        load(
          "/api/market?op=quotes&symbols=" +
            encodeURIComponent(list.slice(i * 16, i * 16 + 16).join(",")),
          shouldForce,
        ),
      ),
    ).then((results) => {
      if (!active) return;
      const quotes = {},
        missing = [];
      for (const r of results) {
        if (r.status === "fulfilled") {
          r.value.quotes.forEach((q) => (quotes[q.symbol] = q));
          missing.push(...(r.value.errors || []));
        } else {
          missing.push(r.reason?.message || "Quote unavailable");
        }
      }
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
