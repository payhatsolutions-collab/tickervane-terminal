// Momentum ranking for the momentum agent (blueprint §8, rebuilt).
//
// The market API's screener already computes, for every Nifty 500 stock, its
// returns over 1 week to 1 year, relative strength vs the Nifty, RSI, trend
// flags, distance from the 52-week high, volume and delivery. Its own 0–100
// score saturates — on a strong day a dozen stocks tie at 100 — so Jarvis ranks
// on its own continuous blend instead. Pure functions; no network.

/** How much each horizon counts. Medium-term momentum leads; 1-year confirms. */
export const WEIGHTS = { r6m: 0.35, r3m: 0.25, r1y: 0.2, rs3m: 0.2 };

/** A leader must be liquid and in an uptrend — momentum in a broken stock is a trap. */
export const LEADER_RULES = {
  minTurnoverCr: 10,    // average daily turnover, ₹ crore
  maxFromHighPct: -15,  // no more than 15% below its 52-week high
  above200: true        // above its 200-day moving average
};

const fin = Number.isFinite;

/** Percentile rank (0–100) of each value within its own column. Missing stays missing. */
export function percentiles(rows, key) {
  const vals = rows.map(r => r[key]).filter(fin).sort((a, b) => a - b);
  const n = vals.length;
  return rows.map(r => {
    if (!fin(r[key]) || n < 2) return null;
    // Average rank among ties, so equal values get equal percentiles.
    let lo = 0, hi = n - 1;
    while (lo < n && vals[lo] < r[key]) lo++;
    while (hi >= 0 && vals[hi] > r[key]) hi--;
    return ((lo + hi) / 2) / (n - 1) * 100;
  });
}

/**
 * Score every stock 0–100 on blended momentum. A stock missing a horizon is
 * scored on the horizons it has, reweighted, but needs at least three of four.
 */
export function rankUniverse(rows) {
  const cols = Object.fromEntries(Object.keys(WEIGHTS).map(k => [k, percentiles(rows, k)]));
  const scored = rows.map((r, i) => {
    let sum = 0, w = 0, have = 0;
    for (const [k, weight] of Object.entries(WEIGHTS)) {
      const p = cols[k][i];
      if (p === null) continue;
      sum += p * weight; w += weight; have++;
    }
    return { ...r, momentum: have >= 3 && w > 0 ? Math.round((sum / w) * 10) / 10 : null };
  }).filter(r => r.momentum !== null);

  scored.sort((a, b) => b.momentum - a.momentum || (b.rs3m ?? 0) - (a.rs3m ?? 0));
  scored.forEach((r, i) => { r.rank = i + 1; });
  return scored;
}

export function isLeaderCandidate(r) {
  // Missing turnover means the day's delivery file lacked the stock, not that
  // it is illiquid — every Nifty 500 member is liquid enough. Only a known low
  // figure excludes.
  return (!fin(r.turnoverCr) || r.turnoverCr >= LEADER_RULES.minTurnoverCr)
    && fin(r.fromHigh) && r.fromHigh >= LEADER_RULES.maxFromHighPct
    && (!LEADER_RULES.above200 || r.above200 === true);
}

/**
 * Today's notable events — the things worth a trader's attention, as opposed to
 * the static list of who is strong.
 */
export function events(r) {
  const out = [];
  if (r.breakout20 && (r.volRatio ?? 0) >= 1.5) {
    out.push({ kind: 'breakout', text: `20-day breakout on ${r.volRatio.toFixed(1)}× volume` });
  } else if (r.breakout20) {
    out.push({ kind: 'breakout-light', text: '20-day breakout, volume not confirming' });
  }
  if (fin(r.fromHigh) && r.fromHigh >= -2) out.push({ kind: 'high', text: 'at or within 2% of 52-week high' });
  if (r.freshCross) out.push({ kind: 'cross', text: 'fresh 50/200-day golden cross' });
  if ((r.delivRatio ?? 0) >= 2 && (r.change ?? 0) > 0) {
    out.push({ kind: 'delivery', text: `delivery ${r.delivRatio.toFixed(1)}× its 20-day average on an up day` });
  }
  if (fin(r.rsi) && r.rsi >= 78) out.push({ kind: 'stretched', text: `RSI ${Math.round(r.rsi)} — stretched` });
  return out;
}

/** One line a trader can read: why this stock is where it is. */
export function describe(r) {
  const p = n => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
  const parts = [];
  if (fin(r.r6m)) parts.push(`6M ${p(r.r6m)}`);
  if (fin(r.r3m)) parts.push(`3M ${p(r.r3m)}`);
  if (fin(r.rs3m)) parts.push(`vs Nifty ${p(r.rs3m)}`);
  if (fin(r.fromHigh)) parts.push(r.fromHigh >= -0.5 ? 'at 52W high' : `${Math.abs(r.fromHigh).toFixed(1)}% off high`);
  return parts.join(' · ');
}

/**
 * Compare today's ranking with the last one. "Entered" and "left" are measured
 * against the top `band` ranks; ranks moved is the change for each symbol.
 */
export function rankChanges(today, previous, { band = 25 } = {}) {
  if (!previous || !previous.length) return { first: true, entered: [], left: [], climbers: [] };
  const prev = new Map(previous.map(p => [p.symbol, p.rank]));
  const now = new Map(today.map(t => [t.symbol, t.rank]));
  const topNow = today.filter(t => t.rank <= band);
  const entered = topNow.filter(t => !(prev.get(t.symbol) <= band))
    .map(t => ({ symbol: t.symbol, rank: t.rank, from: prev.get(t.symbol) ?? null }));
  const left = previous.filter(p => p.rank <= band && !(now.get(p.symbol) <= band))
    .map(p => ({ symbol: p.symbol, rank: now.get(p.symbol) ?? null, from: p.rank }));
  const climbers = today
    .filter(t => prev.has(t.symbol))
    .map(t => ({ symbol: t.symbol, rank: t.rank, from: prev.get(t.symbol), moved: prev.get(t.symbol) - t.rank }))
    .filter(t => t.moved >= 40 && t.rank <= 100)
    .sort((a, b) => b.moved - a.moved)
    .slice(0, 8);
  return { first: false, entered, left, climbers };
}

// ---------------------------------------------------------------------------
// Stocks outside the Nifty 500
// ---------------------------------------------------------------------------

const SESSIONS = { r1w: 5, r1m: 21, r3m: 63, r6m: 126, r1y: 252 };

function rsi14(closes) {
  if (closes.length < 15) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= 14; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  let ag = gain / 14, al = loss / 14;
  for (let i = 15; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * 13 + Math.max(d, 0)) / 14;
    al = (al * 13 + Math.max(-d, 0)) / 14;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * The screener's measures, computed from a stock's own daily bars, so a stock
 * outside the Nifty 500 can be judged on the same terms. `benchR3m` is the
 * Nifty's 3-month return, for relative strength.
 */
export function metricsFromBars(bars, { benchR3m = null } = {}) {
  const b = (bars || []).filter(x => [x.high, x.low, x.close].every(Number.isFinite) && x.close > 0);
  if (b.length < 60) return null;
  const closes = b.map(x => x.close);
  const last = closes.at(-1);
  const ret = n => (closes.length > n ? (last / closes.at(-1 - n) - 1) * 100 : null);
  const out = Object.fromEntries(Object.entries(SESSIONS).map(([k, n]) => [k, ret(n)]));
  const window = b.slice(-252);
  const hi = Math.max(...window.map(x => x.high));
  const lo = Math.min(...window.map(x => x.low));
  const sma = n => (closes.length >= n ? mean(closes.slice(-n)) : null);
  const s50 = sma(50), s200 = sma(200);
  const prior20 = b.slice(-21, -1);
  const vols = b.slice(-21, -1).map(x => x.volume || 0);
  const avgVol = vols.length ? mean(vols) : 0;
  return {
    ...out,
    price: last,
    change: closes.length > 1 ? (last / closes.at(-2) - 1) * 100 : null,
    rsi: rsi14(closes),
    above50: s50 === null ? null : last > s50,
    above200: s200 === null ? null : last > s200,
    fromHigh: (last / hi - 1) * 100,
    fromLow: (last / lo - 1) * 100,
    rs3m: Number.isFinite(out.r3m) && Number.isFinite(benchR3m) ? out.r3m - benchR3m : null,
    breakout20: prior20.length === 20 && last > Math.max(...prior20.map(x => x.high)),
    volRatio: avgVol > 0 ? (b.at(-1).volume || 0) / avgVol : null,
    turnoverCr: avgVol > 0 ? (avgVol * last) / 1e7 : null
  };
}

/**
 * Score a stock that is not in the ranked universe against the universe's own
 * distributions, and say where it would rank. Same weights, same scale.
 */
export function scoreAgainst(ranked, row) {
  let sum = 0, w = 0, have = 0;
  for (const [k, weight] of Object.entries(WEIGHTS)) {
    if (!fin(row[k])) continue;
    const vals = ranked.map(r => r[k]).filter(fin);
    if (vals.length < 2) continue;
    const below = vals.filter(v => v < row[k]).length;
    const equal = vals.filter(v => v === row[k]).length;
    sum += ((below + equal / 2) / vals.length) * 100 * weight;
    w += weight; have++;
  }
  if (have < 3) return null;
  const momentum = Math.round((sum / w) * 10) / 10;
  return { momentum, rank: ranked.filter(r => r.momentum > momentum).length + 1 };
}

/** Which industries the leaders come from — where the market's strength is. */
export function sectorMix(leaders) {
  const counts = new Map();
  for (const l of leaders) counts.set(l.industry || 'Other', (counts.get(l.industry || 'Other') || 0) + 1);
  return [...counts].map(([industry, count]) => ({ industry, count })).sort((a, b) => b.count - a.count);
}
