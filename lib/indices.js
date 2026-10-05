// NSE index history from the daily "ind_close_all" archive: closes plus P/E, P/B
// and dividend yield for every NSE index. Yahoo only carries live quotes for most
// sector indices, so sector rotation and valuation history come from here.
// One ~17 KB file per session; weekly snapshots keep requests to ~26 per cold instance.
import { NSE_HEADERS, istDate, isoDay, ddmmyyyy, num } from './nse.js';

const IND_URL = d => `https://nsearchives.nseindia.com/content/indices/ind_close_all_${ddmmyyyy(d)}.csv`;
const r2 = v => Number.isFinite(v) && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v;
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export const ROTATION = [['Nifty Bank', 'Bank', '^NSEBANK'], ['Nifty Financial Services', 'Fin services', 'NIFTY_FIN_SERVICE.NS'], ['Nifty IT', 'IT', '^CNXIT'], ['Nifty Auto', 'Auto', '^CNXAUTO'], ['Nifty Pharma', 'Pharma', '^CNXPHARMA'], ['Nifty FMCG', 'FMCG', '^CNXFMCG'], ['Nifty Metal', 'Metal', '^CNXMETAL'], ['Nifty Energy', 'Energy', '^CNXENERGY'], ['Nifty PSU Bank', 'PSU Bank', '^CNXPSUBANK'], ['Nifty Realty', 'Realty', '^CNXREALTY'], ['Nifty Media', 'Media', '^CNXMEDIA'], ['Nifty Infrastructure', 'Infra', '^CNXINFRA'], ['Nifty PSE', 'PSE', '^CNXPSE'], ['Nifty India Consumption', 'Consumption', '^CNXCONSUM'], ['Nifty Commodities', 'Commodities', '^CNXCMDT'], ['Nifty Capital Goods', 'Capital goods', null], ['NIFTY Midcap 100', 'Midcap 100', null], ['NIFTY Smallcap 100', 'Smallcap 100', '^CNXSC']];
export const VALUATION = [['Nifty 50', '^NSEI'], ['Nifty Next 50', '^NSMIDCP'], ['Nifty 500', null], ['NIFTY Midcap 100', null], ['NIFTY Smallcap 100', '^CNXSC'], ['Nifty Bank', '^NSEBANK'], ['Nifty IT', '^CNXIT'], ['Nifty FMCG', '^CNXFMCG'], ['Nifty Pharma', '^CNXPHARMA'], ['Nifty Auto', '^CNXAUTO'], ['Nifty Metal', '^CNXMETAL'], ['Nifty Energy', '^CNXENERGY'], ['Nifty PSU Bank', '^CNXPSUBANK'], ['Nifty Realty', '^CNXREALTY'], ['Nifty India Consumption', '^CNXCONSUM']];
const BENCH = 'nifty 50';

/** Parse one ind_close_all CSV into rows keyed by lower-case index name. */
export function parseIndices(text) {
  const lines = String(text || '').split(/\r?\n/);
  const head = (lines.shift() || '').split(',').map(h => h.trim().toLowerCase());
  const at = k => head.findIndex(h => h.startsWith(k));
  const c = { name: at('index name'), date: at('index date'), close: at('closing'), change: at('change(%)'), pe: at('p/e'), pb: at('p/b'), dy: at('div yield') };
  if (c.name < 0 || c.close < 0) return null;
  const rows = new Map();
  let date = null;
  for (const line of lines) {
    const x = line.split(',');
    const close = num(x[c.close]);
    if (!x[c.name] || !(close > 0)) continue;
    if (!date && x[c.date]) { const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(x[c.date].trim()); if (m) date = `${m[3]}-${m[2]}-${m[1]}`; }
    rows.set(x[c.name].trim().toLowerCase(), { close, change: num(x[c.change]), pe: num(x[c.pe]), pb: num(x[c.pb]), dy: num(x[c.dy]) });
  }
  return rows.size ? { date, rows } : null;
}

const dayCache = new Map();
async function fetchDay(d) {
  const key = isoDay(d), hit = dayCache.get(key), today = key === isoDay(istDate());
  if (hit && (hit.data || Date.now() - hit.at < (today ? 1800e3 : 7 * 86400e3))) return hit.data;
  let data = null;
  try {
    const r = await fetch(IND_URL(d), { headers: NSE_HEADERS, signal: AbortSignal.timeout(10000) });
    if (r.ok) data = parseIndices(await r.text());
    else if (r.status !== 404 && r.status !== 403) throw new Error(`NSE index archive returned ${r.status}`);
  } catch (e) { if (hit?.data) return hit.data; throw e; }
  if (data && !data.date) data.date = key;
  if (dayCache.size > 120) dayCache.delete(dayCache.keys().next().value);
  dayCache.set(key, { at: Date.now(), data });
  return data;
}

const shift = (d, days) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + days); return x; };
/** One snapshot per week (last session of each week), newest first. */
export async function weeklySnapshots(weeks = 26) {
  let latest = null, cursor = istDate();
  cursor.setUTCHours(12, 0, 0, 0);
  for (let i = 0; i < 10 && !latest; i++, cursor = shift(cursor, -1)) {
    if (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) continue;
    latest = await fetchDay(cursor).catch(() => null);
    if (latest) latest = { day: new Date(cursor), data: latest };
  }
  if (!latest) throw new Error('NSE index data is temporarily unavailable.');
  // Fridays of earlier weeks; holidays fall back to Thursday, Wednesday…
  const wd = latest.day.getUTCDay();
  const fridays = Array.from({ length: weeks - 1 }, (_, i) => shift(latest.day, -(wd + 2) - 7 * i));
  const out = [latest.data];
  for (let i = 0; i < fridays.length; i += 13) {
    const got = await Promise.all(fridays.slice(i, i + 13).map(async f => {
      for (let back = 0; back < 5; back++) { const d = await fetchDay(shift(f, -back)).catch(() => null); if (d) return d; }
      return null;
    }));
    out.push(...got.filter(Boolean));
  }
  return out;
}

const smaAt = (xs, n, i) => i + 1 >= n ? mean(xs.slice(i + 1 - n, i + 1)) : null;
/**
 * RRG-style coordinates from weekly closes (oldest first). RS = sector ÷ benchmark;
 * RS-Ratio = RS ÷ its 10-week average × 100; RS-Momentum = RS-Ratio ÷ its 5-week average × 100.
 * An open approximation of relative rotation, not JdK's proprietary formula.
 */
export function rrg(closes, bench, tail = 6) {
  const n = Math.min(closes.length, bench.length);
  const rs = Array.from({ length: n }, (_, i) => closes[i] > 0 && bench[i] > 0 ? closes[i] / bench[i] * 100 : null);
  if (rs.some(v => v == null) || n < 15) return [];
  const ratio = rs.map((v, i) => { const m = smaAt(rs, 10, i); return m ? v / m * 100 : null; });
  const mom = ratio.map((v, i) => { const w = ratio.slice(Math.max(0, i - 4), i + 1); return v != null && w.length === 5 && w.every(x => x != null) ? v / mean(w) * 100 : null; });
  return ratio.map((x, i) => x != null && mom[i] != null ? { x: r2(x), y: r2(mom[i]) } : null).filter(Boolean).slice(-tail);
}
export const quadrant = p => !p ? null : p.x >= 100 ? (p.y >= 100 ? 'Leading' : 'Weakening') : (p.y >= 100 ? 'Improving' : 'Lagging');

export async function rotation() {
  const snaps = (await weeklySnapshots(26)).reverse(); // oldest first
  const series = name => snaps.map(s => s.rows.get(name.toLowerCase()) || null);
  const bench = series(BENCH).map(r => r?.close ?? null);
  const ret = (xs, k) => xs.length > k && xs.at(-1 - k) > 0 ? r2((xs.at(-1) / xs.at(-1 - k) - 1) * 100) : null;
  const sectors = ROTATION.flatMap(([name, label, symbol]) => {
    const rows = series(name);
    const ok = rows.map((r, i) => r && bench[i] ? i : -1).filter(i => i >= 0);
    const closes = ok.map(i => rows[i].close), b = ok.map(i => bench[i]);
    if (closes.length < 15) return [];
    const trail = rrg(closes, b);
    return [{ name, label, symbol, trail, quadrant: quadrant(trail.at(-1)), w1: ret(closes, 1), w4: ret(closes, 4), w13: ret(closes, 13), rs13: ret(closes, 13) != null && ret(b, 13) != null ? r2(ret(closes, 13) - ret(b, 13)) : null }];
  });
  const latest = snaps.at(-1);
  const valuation = VALUATION.flatMap(([name, symbol]) => {
    const now = latest.rows.get(name.toLowerCase());
    if (!now || !Number.isFinite(now.pe)) return [];
    const pes = series(name).map(r => r?.pe).filter(Number.isFinite);
    const lo = Math.min(...pes), hi = Math.max(...pes);
    return [{ name, symbol, close: now.close, change: now.change, pe: now.pe, pb: now.pb, dy: now.dy, peLow: lo, peHigh: hi, pePos: hi > lo ? r2((now.pe - lo) / (hi - lo) * 100) : null }];
  });
  return { date: latest.date, weeks: snaps.map(s => s.date), sectors, valuation, source: 'NSE index closing archive (ind_close_all)', fetchedAt: new Date().toISOString() };
}
