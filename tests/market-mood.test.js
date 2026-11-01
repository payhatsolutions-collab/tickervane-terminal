import test from 'node:test';
import assert from 'node:assert/strict';
import { marketMood } from '../src/marketMood.js';

const quote = { price: 25000, change: 1.25, marketTime: Date.parse('2026-10-29T10:00:00Z') / 1000 };
test('market mascot follows the observed change and uses an IST session date', () => {
  assert.equal(marketMood(quote).direction, 'bull');
  assert.equal(marketMood({ ...quote, change: -1.25 }).direction, 'bear');
  assert.equal(marketMood({ ...quote, change: 0 }).direction, 'bull');
  assert.equal(marketMood({ ...quote, change: -0.001 }).direction, 'bull');
  assert.equal(marketMood(quote).date, '29 Oct');
  assert.equal(marketMood({ ...quote, marketTime: Date.parse('2026-10-29T20:00:00Z') / 1000 }).date, '30 Oct');
});
test('missing or invalid quotes cannot produce a directional market animation', () => {
  for (const value of [undefined, {}, { ...quote, price: 0 }, { ...quote, price: NaN }, { ...quote, change: null }, { ...quote, change: Infinity }, { ...quote, marketTime: undefined }, { ...quote, marketTime: 1e20 }]) {
    assert.equal(marketMood(value).direction, 'unknown');
    assert.equal(marketMood(value).key, null);
  }
});
