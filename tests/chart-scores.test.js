import test from 'node:test';
import assert from 'node:assert/strict';
import { chartScores } from '../src/chartScores.js';
import { signalSnapshot } from '../src/marketMath.js';

test('chart scores combine the daily technical signal and reported fundamentals equally', () => {
  const bars = Array.from({ length: 100 }, (_, i) => ({ close: 100 + i }));
  const scores = chartScores(signalSnapshot(bars), { revenueGrowth: 0.2, earningsGrowth: 0.2, roe: 0.25 });
  assert.deepEqual(scores, { alphaNova: 100, technical: 100, fundamental: 100, fundamentalInputs: 3 });
  const declining = signalSnapshot(bars.toReversed());
  assert.equal(chartScores(declining, { revenueGrowth: 0.2, earningsGrowth: 0.2, roe: 0.25 }).alphaNova, 50);
});

test('missing history and incomplete fundamentals are unavailable, including the combined score', () => {
  assert.deepEqual(chartScores(signalSnapshot([]), null), { alphaNova: null, technical: null, fundamental: null, fundamentalInputs: 0 });
  const scores = chartScores(signalSnapshot([]), { revenueGrowth: 0.1, earningsGrowth: NaN, roe: null });
  assert.equal(scores.fundamental, null);
  assert.equal(scores.alphaNova, null);
});

test('partial fundamentals use available metrics, retain real zeroes, and cap extreme values', () => {
  assert.equal(chartScores(null, { revenueGrowth: 0, earningsGrowth: 0 }).fundamental, 33);
  assert.equal(chartScores(null, { revenueGrowth: -2, roe: -0.5 }).fundamental, 0);
  assert.equal(chartScores(null, { revenueGrowth: 8, roe: 4 }).fundamental, 100);
  assert.equal(chartScores(null, { revenueGrowth: '0.2', roe: 0.25 }).fundamental, null);
});
