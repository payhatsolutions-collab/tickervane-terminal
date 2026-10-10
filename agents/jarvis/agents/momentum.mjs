// Agent 3 — Momentum Stocks.
//
// One run, after NSE publishes the day's delivery data (~18:00 IST), produces
// ONE momentum brief:
//   1. leaders — the strongest liquid Nifty 500 stocks in an uptrend, ranked
//   2. today's events — breakouts on volume, new 52-week highs, delivery surges
//   3. what changed — stocks that entered, left or climbed the ranking
//   4. your stocks — where each name on your watchlist stands, and why
//   5. where the strength is — which industries the leaders come from
// No model call: every line here is arithmetic on exchange data, so it costs
// nothing and cannot invent anything.
import { MarketClient } from '../market.mjs';
import {
  rankUniverse, isLeaderCandidate, events, describe, rankChanges, sectorMix,
  metricsFromBars, scoreAgainst
} from '../momentum.mjs';

export const LEADERS = 15;
export const TOP_BAND = 25;

/** Lower is more significant. */
export const EVENT_WEIGHT = { breakout: 0, delivery: 1, cross: 2, high: 3, 'breakout-light': 4 };

/** Where a watchlist stock stands, in one word a trader recognises. */
export function standing(r, total) {
  if (!r) return { label: 'Not in Nifty 500', tone: 'flat' };
  if (r.above200 === false && r.rank > total * 0.6) return { label: 'Weak', tone: 'bad' };
  if (r.rank <= 50 && isLeaderCandidate(r)) return { label: 'Leader', tone: 'good' };
  if (r.rank <= 150) return { label: 'Strong', tone: 'good' };
  if (r.rank > total * 0.7) return { label: 'Lagging', tone: 'bad' };
  return { label: 'Neutral', tone: 'flat' };
}

const slim = r => ({
  symbol: r.symbol, name: r.name, industry: r.industry,
  price: r.price, change: r.change, rank: r.rank, momentum: r.momentum,
  rsi: Number.isFinite(r.rsi) ? Math.round(r.rsi) : null,
  fromHigh: r.fromHigh, delivPct: r.delivPct, volRatio: r.volRatio,
  above50: r.above50, above200: r.above200,
  why: describe(r), events: events(r)
});

async function momentumBrief({ bus, store, now = new Date() }) {
  const client = new MarketClient();
  let screen;
  try {
    screen = await client.screen();
  } catch (e) {
    bus.emit({
      agent: 'momentum', kind: 'observation', severity: 'routine',
      title: 'Momentum scan unavailable — the Nifty 500 screener could not be fetched',
      body: e.message,
      evidence: [{ source: 'market API screener', value: 'unavailable' }]
    });
    return { signals: 1, tokens: 0, toolCalls: client.calls };
  }

  const ranked = rankUniverse(screen.rows || []);
  const total = ranked.length;
  const bySymbol = new Map(ranked.map(r => [r.symbol, r]));
  const date = screen.date || now.toISOString().slice(0, 10);

  const leaders = ranked.filter(isLeaderCandidate).slice(0, LEADERS).map(slim);

  // Most significant first: a breakout on volume outranks a stock that is
  // merely near its high, whatever their momentum ranks.
  const todays = ranked.filter(r => r.rank <= 150)
    .map(r => ({ ...slim(r), events: events(r).filter(e => e.kind !== 'stretched') }))
    .filter(r => r.events.length)
    .map(r => ({ ...r, weight: Math.min(...r.events.map(e => EVENT_WEIGHT[e.kind] ?? 9)) }))
    .sort((a, b) => a.weight - b.weight || a.rank - b.rank)
    .slice(0, 12)
    .map(({ weight, ...r }) => r);

  const previous = store.previousRanks(date);
  const changes = rankChanges(ranked, previous.ranks, { band: TOP_BAND });
  store.saveRanks(date, ranked);

  // Your stocks. Ones outside the Nifty 500 are measured from their own price
  // history and placed against the same distribution, so they are judged on
  // the same terms rather than shown as "no data".
  const benchR3m = screen.benchmark?.r3m ?? null;
  const watch = await Promise.all(store.getWatchlist().map(async w => {
    const r = bySymbol.get(w.symbol);
    if (r) return { symbol: w.symbol, source: w.source, inUniverse: true, ...slim(r), standing: standing(r, total) };

    let bars = null;
    for (const suffix of ['.NS', '.BO']) {
      try { bars = (await client.get('chart', { symbol: w.symbol + suffix, range: '1y' })).bars; break; }
      catch { /* try the other exchange */ }
    }
    const m = bars ? metricsFromBars(bars, { benchR3m }) : null;
    const s = m ? scoreAgainst(ranked, m) : null;
    if (!m || !s) {
      return { symbol: w.symbol, source: w.source, inUniverse: false, standing: { label: 'No price data', tone: 'flat' } };
    }
    const row = { ...m, symbol: w.symbol, name: w.symbol, industry: null, ...s };
    return { source: w.source, inUniverse: false, ...slim(row), standing: standing(row, total) };
  }));
  watch.sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));

  const mix = sectorMix(ranked.filter(isLeaderCandidate).slice(0, 50));

  // Severity: louder only when something happened to YOUR stocks.
  const watchSet = new Set(watch.map(w => w.symbol));
  const yourBreakouts = watch.filter(w => (w.events || []).some(e => e.kind === 'breakout'));
  const yourEntries = changes.entered.filter(e => watchSet.has(e.symbol));
  const severity = yourBreakouts.length || yourEntries.length ? 'notable' : 'routine';

  const breakouts = ranked.filter(r => r.rank <= 150 && events(r).some(e => e.kind === 'breakout')).length;
  const yoursInTop50 = watch.filter(w => w.rank && w.rank <= 50).length;
  const titleParts = [
    mix[0] ? `${mix[0].industry} leads (${mix[0].count} of the top 50)` : null,
    leaders[0] ? `strongest: ${leaders[0].symbol}` : null,
    `${breakouts} breakout${breakouts === 1 ? '' : 's'} on volume`,
    watch.length ? `${yoursInTop50} of your ${watch.length} stocks in the top 50` : null
  ].filter(Boolean);

  const body = [
    `Top ${LEADERS} by momentum (liquid, above the 200-day average, within 15% of the 52-week high): ${leaders.map(l => l.symbol).join(', ')}.`,
    yourBreakouts.length ? `Your stocks breaking out: ${yourBreakouts.map(w => w.symbol).join(', ')}.` : null,
    changes.first
      ? 'First ranking stored — from the next run Jarvis will report what entered, left or climbed.'
      : `${changes.entered.length} entered and ${changes.left.length} left the top ${TOP_BAND} since ${previous.date}.`
  ].filter(Boolean).join('\n');

  bus.emit({
    agent: 'momentum',
    kind: 'observation',
    severity,
    title: `Momentum: ${titleParts.join(' · ')}`.slice(0, 200),
    body,
    subjects: [
      ...leaders.slice(0, 8).map(l => ({ type: 'symbol', ref: l.symbol })),
      ...mix.slice(0, 3).map(m => ({ type: 'sector', ref: m.industry }))
    ],
    evidence: leaders.slice(0, 8).map(l => ({
      source: 'NSE + Yahoo via market screener', symbol: l.symbol, value: l.price, changePct: l.change
    })),
    data: {
      kind: 'momentum_brief',
      date,
      generatedAt: now.toISOString(),
      universe: total,
      rules: 'Liquid (≥ ₹10 cr daily turnover), above the 200-day average, within 15% of the 52-week high',
      leaders, todays, changes: { ...changes, since: previous.date }, watch, sectors: mix.slice(0, 8),
      source: screen.source || 'Nifty 500 screener'
    },
    expiresAt: new Date(now.getTime() + 24 * 3600_000).toISOString()
  });

  return { signals: 1, tokens: 0, toolCalls: client.calls };
}

export const momentum = {
  name: 'momentum',
  tools: ['market', 'watchlist:read'],
  intents: {
    momentum_brief: ctx => momentumBrief(ctx)
  }
};

export default momentum;
