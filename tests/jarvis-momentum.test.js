import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  percentiles, rankUniverse, isLeaderCandidate, events, rankChanges, sectorMix,
  metricsFromBars, scoreAgainst, WEIGHTS
} from '../agents/jarvis/momentum.mjs';
import { standing, EVENT_WEIGHT, momentum as agent } from '../agents/jarvis/agents/momentum.mjs';
import { Memory } from '../agents/jarvis/memory.mjs';
import { createDashboard, HOST } from '../agents/jarvis/server.mjs';
import { load, SCHEDULE_PATH } from '../agents/jarvis/scheduler.mjs';

const stock = (symbol, over = {}) => ({
  symbol, name: symbol, industry: 'Capital Goods', price: 100, change: 1,
  r3m: 10, r6m: 20, r1y: 30, rs3m: 5, above200: true, fromHigh: -5, turnoverCr: 50, ...over
});

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

test('percentiles are 0–100 and ties share a value', () => {
  const p = percentiles([{ x: 1 }, { x: 2 }, { x: 2 }, { x: 3 }], 'x');
  assert.equal(p[0], 0);
  assert.equal(p[3], 100);
  assert.equal(p[1], p[2], 'equal values get equal percentiles');
});

test('ranking is continuous, so stocks do not tie at the top the way a capped score does', () => {
  const rows = Array.from({ length: 30 }, (_, i) => stock(`S${i}`, { r6m: i, r3m: i * 2, r1y: i * 3, rs3m: i }));
  const ranked = rankUniverse(rows);
  assert.equal(ranked[0].symbol, 'S29');
  assert.equal(ranked[0].rank, 1);
  assert.equal(new Set(ranked.map(r => r.momentum)).size, 30);
});

test('a stock missing two horizons is not ranked; missing one is reweighted', () => {
  const rows = [
    stock('FULL'), stock('ONEGAP', { r1y: null }), stock('TWOGAPS', { r1y: null, r6m: null }), stock('OTHER', { r6m: 5 })
  ];
  const syms = rankUniverse(rows).map(r => r.symbol);
  assert.ok(syms.includes('ONEGAP'));
  assert.ok(!syms.includes('TWOGAPS'));
});

test('weights sum to 1', () => {
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 1);
});

test('leaders must be in an uptrend and near their high', () => {
  assert.equal(isLeaderCandidate(stock('OK')), true);
  assert.equal(isLeaderCandidate(stock('DOWNTREND', { above200: false })), false);
  assert.equal(isLeaderCandidate(stock('FAR', { fromHigh: -30 })), false);
  assert.equal(isLeaderCandidate(stock('THIN', { turnoverCr: 2 })), false);
});

test('missing turnover does not exclude a leader (regression: STLTECH, ranked #1, was dropped)', () => {
  assert.equal(isLeaderCandidate(stock('STLTECH', { turnoverCr: null })), true);
});

// ---------------------------------------------------------------------------
// Events and changes
// ---------------------------------------------------------------------------

test('a breakout is only "on volume" when volume confirms it', () => {
  assert.equal(events(stock('A', { breakout20: true, volRatio: 2.1 }))[0].kind, 'breakout');
  assert.equal(events(stock('B', { breakout20: true, volRatio: 0.8 }))[0].kind, 'breakout-light');
});

test('a volume breakout outranks a stock merely near its high', () => {
  assert.ok(EVENT_WEIGHT.breakout < EVENT_WEIGHT.high);
});

test('delivery surge counts only on an up day', () => {
  assert.ok(events(stock('UP', { delivRatio: 2.5, change: 1 })).some(e => e.kind === 'delivery'));
  assert.ok(!events(stock('DOWN', { delivRatio: 2.5, change: -1 })).some(e => e.kind === 'delivery'));
});

test('the first run says so instead of inventing changes', () => {
  assert.equal(rankChanges([{ symbol: 'A', rank: 1 }], []).first, true);
});

test('rank changes report entries, exits and big climbers', () => {
  const prev = [{ symbol: 'OLD', rank: 3 }, { symbol: 'NEW', rank: 60 }, { symbol: 'JUMP', rank: 140 }];
  const now = [{ symbol: 'NEW', rank: 4 }, { symbol: 'OLD', rank: 40 }, { symbol: 'JUMP', rank: 70 }];
  const c = rankChanges(now, prev, { band: 25 });
  assert.deepEqual(c.entered.map(e => e.symbol), ['NEW']);
  assert.deepEqual(c.left.map(e => e.symbol), ['OLD']);
  assert.ok(c.climbers.some(e => e.symbol === 'JUMP' && e.moved === 70));
});

test('sector mix counts industries among leaders', () => {
  const mix = sectorMix([stock('A'), stock('B'), stock('C', { industry: 'Healthcare' })]);
  assert.deepEqual(mix[0], { industry: 'Capital Goods', count: 2 });
});

// ---------------------------------------------------------------------------
// Stocks outside the Nifty 500
// ---------------------------------------------------------------------------

function bars(n, drift) {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 * (1 + drift) ** i;
    return { time: `d${i}`, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1e6 };
  });
}

test('metrics from bars: an uptrend reads as one', () => {
  const m = metricsFromBars(bars(260, 0.003), { benchR3m: 2 });
  assert.ok(m.r6m > 0 && m.r1y > m.r6m);
  assert.equal(m.above50, true);
  assert.equal(m.above200, true);
  assert.ok(m.fromHigh > -2);
  assert.ok(Math.abs(m.rs3m - (m.r3m - 2)) < 1e-9);
});

test('metrics from bars: too little history is refused, not guessed', () => {
  assert.equal(metricsFromBars(bars(30, 0.01)), null);
});

test('an outside stock is placed on the universe scale', () => {
  const universe = rankUniverse(Array.from({ length: 50 }, (_, i) =>
    stock(`S${i}`, { r6m: i, r3m: i, r1y: i, rs3m: i })));
  const top = scoreAgainst(universe, { r6m: 999, r3m: 999, r1y: 999, rs3m: 999 });
  const bottom = scoreAgainst(universe, { r6m: -999, r3m: -999, r1y: -999, rs3m: -999 });
  assert.equal(top.rank, 1);
  // Ties the weakest member, so it shares last place rather than going below it.
  assert.equal(bottom.rank, universe.length);
  assert.equal(scoreAgainst(universe, { r6m: 1 }), null, 'needs three of four horizons');
});

test('standing labels', () => {
  assert.equal(standing(null, 500).label, 'Not in Nifty 500');
  assert.equal(standing(stock('L', { rank: 10 }), 500).label, 'Leader');
  assert.equal(standing(stock('S', { rank: 120 }), 500).label, 'Strong');
  assert.equal(standing(stock('W', { rank: 400, above200: false }), 500).label, 'Weak');
});

// ---------------------------------------------------------------------------
// Watchlist and stored ranks
// ---------------------------------------------------------------------------

test('watchlist stores valid symbols only, once each', () => {
  const m = new Memory(':memory:');
  const r = m.addToWatchlist(['reliance', 'RELIANCE.NS', 'bad symbol!', 'M&M'], 'kite');
  assert.deepEqual(r.added, ['RELIANCE', 'M&M']);
  assert.deepEqual(r.rejected, ['bad symbol!']);
  assert.equal(m.getWatchlist().length, 2);
  assert.equal(m.removeFromWatchlist('reliance'), true);
  assert.deepEqual(m.getWatchlist().map(w => w.symbol), ['M&M']);
  m.close();
});

test('previous ranks come from the latest earlier trading date', () => {
  const m = new Memory(':memory:');
  m.saveRanks('2026-10-07', [{ symbol: 'A', rank: 5, momentum: 90 }]);
  m.saveRanks('2026-10-08', [{ symbol: 'A', rank: 3, momentum: 92 }]);
  m.saveRanks('2026-10-09', [{ symbol: 'A', rank: 1, momentum: 95 }]);
  const p = m.previousRanks('2026-10-09');
  assert.equal(p.date, '2026-10-08');
  assert.equal(p.ranks[0].rank, 3);
  assert.equal(m.previousRanks('2026-10-07').date, null);
  m.close();
});

test('the watchlist can be edited from the dashboard API', async () => {
  const store = new Memory(':memory:');
  const server = createDashboard({ store });
  await new Promise(r => server.listen(0, HOST, r));
  const base = `http://${HOST}:${server.address().port}/api/watchlist`;
  const post = body => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  try {
    const a = await post({ add: ['HAL', 'TATAMOTORS', 'not valid'] });
    assert.deepEqual(a.added.sort(), ['HAL', 'TATAMOTORS']);
    assert.deepEqual(a.rejected, ['not valid']);
    const b = await post({ remove: 'HAL' });
    assert.equal(b.removed, true);
    assert.deepEqual((await (await fetch(base)).json()).watchlist.map(w => w.symbol), ['TATAMOTORS']);
  } finally {
    await new Promise(r => server.close(r));
    store.close();
  }
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test('the momentum agent is scheduled once a weekday after NSE publishes delivery data', () => {
  const rule = load(SCHEDULE_PATH).find(r => r.agent === 'momentum');
  assert.equal(rule.intent, 'momentum_brief');
  assert.equal(rule.cron, '45 18 * * 1-5');
  assert.deepEqual(Object.keys(agent.intents), ['momentum_brief']);
});
