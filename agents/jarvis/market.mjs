// The agents' only data tool: a thin client over the same /api/market endpoints
// the UI uses (blueprint §2). Deliberately not a second Yahoo parser — one
// normalization path, one cache, one set of tests.
//
// Base URL defaults to the deployed terminal because it is always on and edge-
// cached. Point it at the dev server while iterating:
//   JARVIS_MARKET_BASE=http://localhost:5177 npm run jarvis -- tick
import { completedDailyBars } from '../../src/tradeMath.js';

export const BASE = (process.env.JARVIS_MARKET_BASE || 'https://tickervane.vercel.app').replace(/\/$/, '');

const QUOTE_BATCH = 16; // the endpoint's documented cap

export class MarketClient {
  constructor({ base = BASE, timeoutMs = 12_000 } = {}) {
    this.base = base;
    this.timeoutMs = timeoutMs;
    this.calls = 0;
  }

  async get(op, params = {}) {
    const url = new URL(`${this.base}/api/market`);
    url.searchParams.set('op', op);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    this.calls++;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'jarvis/1.0' },
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || `${op} failed (${res.status})`);
    return body;
  }

  /** Quotes for any number of symbols, batched to respect the 16-symbol cap. */
  async quotes(symbols) {
    const list = [...new Set((symbols || []).filter(Boolean))];
    const out = {};
    const missing = [];
    for (let i = 0; i < list.length; i += QUOTE_BATCH) {
      const batch = list.slice(i, i + QUOTE_BATCH);
      try {
        const data = await this.get('quotes', { symbols: batch.join(',') });
        for (const q of data.quotes || []) out[q.symbol] = q;
        missing.push(...(data.errors || []));
      } catch (e) {
        // One failed batch must not cost the others. The caller sees which
        // symbols are absent and can degrade honestly.
        missing.push(...batch);
      }
    }
    return { quotes: out, missing };
  }

  /**
   * Trailing completed daily closes, oldest first — the baseline the materiality
   * gate measures sigma against. Excludes the current exchange date, matching
   * how the rest of the terminal treats in-progress sessions.
   */
  async dailyCloses(symbol, { sessions = 21, range = '3mo' } = {}) {
    const data = await this.get('chart', { symbol, range });
    const bars = completedDailyBars(data.bars || [], data.timezone || 'Asia/Kolkata');
    return bars.slice(-sessions).map(b => b.close).filter(Number.isFinite);
  }

  /** Theme news plus the theme's lead/linked configuration (api THEMES). */
  theme(name, { days = 3 } = {}) {
    return this.get('macronews', { theme: name, days });
  }
}
