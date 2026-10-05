// NSE end-of-day data for the Delivery Radar and the screener.
// Source: NSE's official security-wise delivery bhavcopy (one CSV per session)
// plus the Nifty 500 constituent list. Price history for the screener comes from
// Yahoo's batched spark endpoint (20 symbols per request). Everything is cached
// per instance; the API layer adds CDN caching so Vercel Hobby quotas stay small.
import { stockDirectory } from '../src/stocks.js';

const NSE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
export const NSE_HEADERS = { 'User-Agent': NSE_UA, Accept: 'text/csv,*/*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.nseindia.com/all-reports' };
export const BHAV_URL = d => `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${d}.csv`;
const N500_URL = 'https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv';
export const BASELINE = 20;
const names = new Map(stockDirectory.map(s => [s.symbol, s.name]));

const pad = n => String(n).padStart(2, '0');
// IST calendar date for "now" (UTC+5:30, no DST).
export const istDate = (ms = Date.now()) => new Date(ms + 5.5 * 3600e3);
export const ddmmyyyy = d => `${pad(d.getUTCDate())}${pad(d.getUTCMonth() + 1)}${d.getUTCFullYear()}`;
export const isoDay = d => d.toISOString().slice(0, 10);
export const num = s => { const v = parseFloat(String(s ?? '').trim()); return Number.isFinite(v) ? v : null; };

/** Parse one sec_bhavdata_full CSV into validated EQ rows keyed by symbol. */
export function parseBhav(text) {
  const lines = String(text || '').split(/\r?\n/);
  const header = (lines.shift() || '').split(',').map(h => h.trim().toUpperCase());
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  const need = ['SYMBOL', 'SERIES', 'DATE1', 'PREV_CLOSE', 'HIGH_PRICE', 'LOW_PRICE', 'CLOSE_PRICE', 'AVG_PRICE', 'TTL_TRD_QNTY', 'TURNOVER_LACS', 'DELIV_QTY', 'DELIV_PER'];
  if (!need.every(k => k in col)) return null;
  const rows = new Map();
  let date = null;
  for (const line of lines) {
    if (!line) continue;
    const c = line.split(',').map(x => x.trim());
    if (c[col.SERIES] !== 'EQ') continue;
    const symbol = c[col.SYMBOL]?.toUpperCase();
    const prev = num(c[col.PREV_CLOSE]), high = num(c[col.HIGH_PRICE]), low = num(c[col.LOW_PRICE]), close = num(c[col.CLOSE_PRICE]);
    const qty = num(c[col.TTL_TRD_QNTY]), turnover = num(c[col.TURNOVER_LACS]), avg = num(c[col.AVG_PRICE]);
    let dq = num(c[col.DELIV_QTY]), dp = num(c[col.DELIV_PER]);
    if (!symbol || ![prev, high, low, close, qty, turnover].every(Number.isFinite) || close <= 0 || high < low || qty < 0) continue;
    // Some rows carry "-" for delivery; others fail the qty/percent cross-check.
    if (dq == null || dp == null || dq > qty || dp < 0 || dp > 100 || (qty > 0 && Math.abs(dp - dq / qty * 100) > 0.5)) { dq = null; dp = null; }
    if (!date) { const t = Date.parse(c[col.DATE1] + ' UTC'); if (Number.isFinite(t)) date = new Date(t).toISOString().slice(0, 10); }
    const clv = high > low ? ((close - low) - (high - close)) / (high - low) : 0;
    rows.set(symbol, { prev, open: num(c[col.OPEN_PRICE]), high, low, close, avg: avg ?? close, qty, turnover, dq, dp, clv });
  }
  return { date, rows };
}

const bhavCache = new Map();
async function fetchBhav(day) {
  const key = ddmmyyyy(day), hit = bhavCache.get(key);
  const today = isoDay(istDate()) === isoDay(day);
  // A missing file for today may appear after ~18:00 IST; older misses are holidays.
  if (hit && (hit.data || Date.now() - hit.at < (today ? 1800e3 : 7 * 86400e3))) return hit.data;
  let data = null;
  try {
    const r = await fetch(BHAV_URL(key), { headers: NSE_HEADERS, signal: AbortSignal.timeout(12000) });
    if (r.ok) data = parseBhav(await r.text());
    else if (r.status !== 404) throw new Error(`NSE archive returned ${r.status}`);
  } catch (e) { if (hit?.data) return hit.data; throw e; }
  if (data && !data.date) data.date = isoDay(day);
  if (bhavCache.size > 60) bhavCache.delete(bhavCache.keys().next().value);
  bhavCache.set(key, { at: Date.now(), data });
  return data;
}

/** Most recent `count` trading sessions, newest first. Weekends are skipped without a request. */
export async function recentSessions(count = BASELINE + 1) {
  const out = [];
  const cursor = istDate();
  cursor.setUTCHours(12, 0, 0, 0);
  let errors = 0, scanned = 0;
  while (out.length < count && scanned < 60) {
    const batch = [];
    while (batch.length < 8 && scanned < 60) {
      const d = new Date(cursor); cursor.setUTCDate(cursor.getUTCDate() - 1); scanned++;
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) batch.push(d);
    }
    const got = await Promise.all(batch.map(d => fetchBhav(d).catch(() => { errors++; return null; })));
    for (const g of got) if (g && out.length < count) out.push(g);
    if (errors > 6) break;
  }
  if (!out.length) throw new Error('NSE delivery data is temporarily unavailable. Try again shortly.');
  return out;
}

let n500 = { at: 0, map: null };
/** Nifty 500 membership with industry, cached for 12 hours. */
export async function nifty500() {
  if (n500.map && Date.now() - n500.at < 43200e3) return n500.map;
  try {
    const r = await fetch(N500_URL, { headers: NSE_HEADERS, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('list unavailable');
    const map = new Map();
    for (const line of (await r.text()).split(/\r?\n/).slice(1)) {
      const c = line.split(',');
      if (c.length >= 3 && /^[A-Z0-9&-]+$/.test(c[2]?.trim())) map.set(c[2].trim(), { name: c[0].trim().replace(/ Ltd\.?$/, ''), industry: c[1].trim() });
    }
    if (map.size >= 450) n500 = { at: Date.now(), map };
  } catch { /* keep the previous list, if any */ }
  return n500.map || new Map();
}

// Two decimals is all the UI shows; this roughly halves the JSON payload.
const r2 = v => typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v;
const tidy = row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Array.isArray(v) ? v.map(r2) : r2(v)]));
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

/** Per-symbol delivery stats for the latest session against the prior 20 sessions. */
export function deliveryStats(sessions, symbol) {
  const [latest, ...prior] = sessions;
  const row = latest?.rows.get(symbol);
  if (!row) return null;
  const base = prior.slice(0, BASELINE).map(s => s.rows.get(symbol)).filter(Boolean);
  const withDel = base.filter(b => b.dq != null);
  const avgDq = mean(withDel.map(b => b.dq)), avgDp = mean(withDel.map(b => b.dp));
  const avgQty = mean(base.map(b => b.qty)), avgTurn = mean(base.map(b => b.turnover));
  const history = sessions.slice(0, 10).map(s => s.rows.get(symbol)?.dp ?? null).reverse();
  let streak = 0;
  for (const s of sessions.slice(0, 10)) { const r = s.rows.get(symbol); if (r?.dp != null && avgDp != null && r.dp > avgDp) streak++; else break; }
  return {
    symbol, date: latest.date, close: row.close, change: row.prev > 0 ? (row.close / row.prev - 1) * 100 : null,
    delivPct: row.dp, delivPctAvg: avgDp, delivQty: row.dq, delivQtyAvg: avgDq,
    delivRatio: row.dq != null && avgDq > 0 ? row.dq / avgDq : null,
    volRatio: avgQty > 0 ? row.qty / avgQty : null, qty: row.qty,
    turnoverCr: row.turnover / 100, turnoverAvgCr: avgTurn != null ? avgTurn / 100 : null,
    delivValueCr: row.dq != null ? row.dq * row.avg / 1e7 : null,
    clv: row.clv, samples: withDel.length, streak, history,
  };
}

/** Classify a delivery spike by where price closed inside the day's range. */
export function deliverySignal(s) {
  if (!s || s.delivRatio == null) return 'Insufficient';
  // A quantity spike on collapsing delivery share is intraday churn, not positioning.
  const share = s.delivPct >= Math.min(35, (s.delivPctAvg ?? 0) * 0.8);
  if (share && s.delivRatio >= 1.8 && s.change > 0 && s.clv >= 0.25) return 'Accumulation';
  if (share && s.delivRatio >= 1.8 && s.change < 0 && s.clv <= -0.25) return 'Distribution';
  if (s.delivPct >= 60 && s.delivPctAvg > 0 && s.delivPct >= s.delivPctAvg * 1.25) return 'High conviction';
  if (s.delivRatio >= 1.8) return 'Spike';
  return 'Normal';
}

/** Rank every liquid EQ symbol by delivered quantity versus its 20-session average. */
export function buildRadar(sessions, universe = new Map(), { minTurnoverCr = 1, limit = 400 } = {}) {
  const latest = sessions[0];
  const rows = [];
  let eligible = 0;
  for (const symbol of latest.rows.keys()) {
    const s = deliveryStats(sessions, symbol);
    if (!s || s.delivRatio == null || s.samples < Math.min(15, sessions.length - 1)) continue;
    eligible++;
    const u = universe.get(symbol);
    // Listed companies only (ETFs and index funds are not in either directory), with
    // a baseline that is not microscopic, so ratios are not 100× on a few hundred shares.
    if (!u && !names.has(symbol)) continue;
    if (s.turnoverCr < minTurnoverCr || !(s.turnoverAvgCr >= Math.min(0.25, minTurnoverCr))) continue;
    rows.push({ ...s, name: u?.name || names.get(symbol) || symbol, industry: u?.industry || null, n500: !!u, signal: deliverySignal(s) });
  }
  rows.sort((a, b) => b.delivRatio - a.delivRatio || b.delivPct - a.delivPct);
  const counts = rows.reduce((t, r) => (t[r.signal] = (t[r.signal] || 0) + 1, t), {});
  return {
    date: latest.date, sessions: sessions.map(s => s.date), baseline: Math.min(BASELINE, sessions.length - 1),
    coverage: { eq: latest.rows.size, eligible, liquid: rows.length, minTurnoverCr }, counts,
    rows: rows.filter((r, i) => i < limit || r.n500).map(({ date, ...r }) => tidy(r)), source: 'NSE security-wise delivery bhavcopy', sourceUrl: BHAV_URL(ddmmyyyy(new Date(latest.date + 'T12:00:00Z'))),
    fetchedAt: new Date().toISOString(),
  };
}

// ---------- Screener dataset ----------
const sparkCache = new Map();
async function sparkBatch(symbols) {
  const url = host => `https://${host}.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbols.join(','))}&range=1y&interval=1d`;
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(url(host), { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
      if (!r.ok) continue;
      const j = await r.json();
      const out = new Map();
      for (const item of j?.spark?.result || []) {
        const res = item?.response?.[0], closes = res?.indicators?.quote?.[0]?.close;
        if (!Array.isArray(closes)) continue;
        const clean = closes.filter(v => Number.isFinite(v) && v > 0);
        if (clean.length > 30) out.set(item.symbol, { closes: clean, meta: res.meta || {} });
      }
      return out;
    } catch { /* try the other host */ }
  }
  return new Map();
}
/** 1-year daily closes for many Yahoo symbols, 20 per request, five requests at a time. */
export async function sparkMany(symbols) {
  const out = new Map(), todo = [];
  for (const s of symbols) { const h = sparkCache.get(s); if (h && Date.now() - h.at < 600e3) out.set(s, h.data); else todo.push(s); }
  const chunks = [];
  for (let i = 0; i < todo.length; i += 20) chunks.push(todo.slice(i, i + 20));
  for (let i = 0; i < chunks.length; i += 5) {
    const got = await Promise.all(chunks.slice(i, i + 5).map(sparkBatch));
    for (const m of got) for (const [s, d] of m) { out.set(s, d); sparkCache.set(s, { at: Date.now(), data: d }); }
  }
  if (sparkCache.size > 1500) for (const k of [...sparkCache.keys()].slice(0, 500)) sparkCache.delete(k);
  return out;
}

function rsi14(closes) {
  if (closes.length < 16) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= 14; i++) { const d = closes[i] - closes[i - 1]; g += Math.max(d, 0) / 14; l += Math.max(-d, 0) / 14; }
  for (let i = 15; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; g = (g * 13 + Math.max(d, 0)) / 14; l = (l * 13 + Math.max(-d, 0)) / 14; }
  return l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l);
}
const sma = (xs, n, end = xs.length) => end >= n ? mean(xs.slice(end - n, end)) : null;
const ret = (xs, n) => xs.length > n ? (xs.at(-1) / xs.at(-1 - n) - 1) * 100 : null;
function rankPct(rows, key) {
  const vals = rows.map(r => r[key]).filter(Number.isFinite).sort((a, b) => a - b);
  return v => { if (!Number.isFinite(v) || !vals.length) return null; let lo = 0, hi = vals.length; while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] <= v) lo = m + 1; else hi = m; } return lo / vals.length * 100; };
}

/** Technical, momentum, volume and delivery metrics for one symbol. Pure — easy to test. */
export function screenMetrics(closes, bhav, bench) {
  const c = closes || [];
  const price = c.at(-1) ?? bhav?.close ?? null;
  const s50 = sma(c, 50), s150 = sma(c, 150), s200 = sma(c, 200), s50Prev = sma(c, 50, c.length - 10), s200Prev = sma(c, 200, c.length - 10), s200Month = sma(c, 200, c.length - 21);
  const hi = c.length ? Math.max(...c.slice(-252)) : null, lo = c.length ? Math.min(...c.slice(-252)) : null;
  const logs = c.slice(-21).map((v, i, a) => i ? Math.log(v / a[i - 1]) : null).slice(1);
  const m = mean(logs), vol = logs.length > 5 ? Math.sqrt(logs.reduce((t, x) => t + (x - m) ** 2, 0) / (logs.length - 1)) * Math.sqrt(252) * 100 : null;
  const r3m = ret(c, 63);
  return {
    price, change: c.length > 1 ? (c.at(-1) / c.at(-2) - 1) * 100 : bhav?.change ?? null,
    r1w: ret(c, 5), r1m: ret(c, 21), r3m, r6m: ret(c, 126), r1y: c.length > 200 ? (c.at(-1) / c[0] - 1) * 100 : null,
    rsi: rsi14(c.slice(-120)), sma50: s50, sma200: s200,
    above50: s50 != null && price != null ? price > s50 : null, above200: s200 != null && price != null ? price > s200 : null,
    golden: s50 != null && s200 != null ? s50 > s200 : null,
    freshCross: s50 != null && s200 != null && s50Prev != null && s200Prev != null ? s50 > s200 && s50Prev <= s200Prev : false,
    fromHigh: hi && price ? (price / hi - 1) * 100 : null, fromLow: lo && price ? (price / lo - 1) * 100 : null,
    volatility: vol, rs3m: r3m != null && bench != null ? r3m - bench : null,
    // Minervini trend template (price/MA structure only; the RS rank leg is the screen's score filter).
    trendTemplate: [s50, s150, s200, s200Month, hi, lo, price].every(Number.isFinite)
      ? price > s150 && price > s200 && s150 > s200 && s200 > s200Month && s50 > s150 && s50 > s200 && price > s50 && price >= lo * 1.3 && price >= hi * 0.75
      : null,
  };
}

/** Nifty 500 screener rows: Yahoo 1Y closes + NSE bhavcopy volume/delivery + composite score. */
export async function buildScreen() {
  const [sessions, universe] = await Promise.all([recentSessions(BASELINE + 1), nifty500()]);
  let symbols = [...universe.keys()];
  if (symbols.length < 100) {
    // List unavailable: fall back to the 500 most traded EQ symbols of the latest session.
    symbols = [...sessions[0].rows.entries()].sort((a, b) => b[1].turnover - a[1].turnover).slice(0, 500).map(([s]) => s);
  }
  const spark = await sparkMany(['^NSEI', ...symbols.map(s => `${s}.NS`)]);
  const bench = spark.get('^NSEI')?.closes;
  const bench3m = bench ? ret(bench, 63) : null;
  const latestHighs = s => Math.max(...sessions.slice(1, BASELINE + 1).map(x => x.rows.get(s)?.high ?? -Infinity));
  const rows = symbols.map(symbol => {
    const del = deliveryStats(sessions, symbol);
    const sp = spark.get(`${symbol}.NS`);
    const m = screenMetrics(sp?.closes, del, bench3m);
    const b = sessions[0].rows.get(symbol);
    const prior20High = latestHighs(symbol);
    const u = universe.get(symbol);
    return {
      symbol, name: u?.name || names.get(symbol) || symbol, industry: u?.industry || 'Other', ...m,
      volRatio: del?.volRatio ?? null, delivPct: del?.delivPct ?? null, delivRatio: del?.delivRatio ?? null,
      turnoverCr: del?.turnoverAvgCr ?? del?.turnoverCr ?? null,
      breakout20: b && Number.isFinite(prior20High) ? b.close > prior20High : false,
      hasHistory: !!sp,
    };
  }).filter(r => Number.isFinite(r.price));
  // Composite 0–100: momentum (1M/3M/6M), relative strength, 52W-high proximity, trend and delivery.
  const rk = Object.fromEntries(['r1m', 'r3m', 'r6m', 'rs3m', 'fromHigh', 'delivRatio'].map(k => [k, rankPct(rows, k)]));
  for (const r of rows) {
    const parts = [[rk.r1m(r.r1m), 1], [rk.r3m(r.r3m), 2], [rk.r6m(r.r6m), 1.5], [rk.rs3m(r.rs3m), 1.5], [rk.fromHigh(r.fromHigh), 1.5], [rk.delivRatio(r.delivRatio), 0.5]].filter(([v]) => v != null);
    const w = parts.reduce((t, [, x]) => t + x, 0);
    let score = w ? parts.reduce((t, [v, x]) => t + v * x, 0) / w : null;
    if (score != null) score = Math.max(0, Math.min(100, score + (r.above200 ? 5 : r.above200 === false ? -5 : 0) + (r.golden ? 3 : 0)));
    r.score = score == null ? null : Math.round(score);
  }
  return {
    date: sessions[0].date, universe: universe.size >= 450 ? 'Nifty 500' : 'Top 500 by turnover',
    coverage: { symbols: symbols.length, rows: rows.length, withHistory: rows.filter(r => r.hasHistory).length },
    benchmark: { symbol: '^NSEI', r3m: r2(bench3m) }, rows: rows.map(({ sma50, sma200, ...r }) => tidy(r)),
    source: 'Yahoo Finance (1Y daily closes) + NSE delivery bhavcopy', fetchedAt: new Date().toISOString(),
  };
}
