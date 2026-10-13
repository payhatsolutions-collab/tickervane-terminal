import test from 'node:test';
import assert from 'node:assert/strict';
import { fmt, compact } from '../src/format.js';

test('cached quote formatters preserve grouping, precision, rounding and missing values', () => {
  const values = [0, -0, 1.005, -1234.5678, 12345678.9, 0.000001, Number.MAX_SAFE_INTEGER];
  for (const digits of [0, 1, 2, 3, 4, 8]) {
    for (const value of values) assert.equal(fmt(value, digits), value.toLocaleString('en-IN', {
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    }));
  }
  for (const value of values) assert.equal(compact(value), Intl.NumberFormat('en', {
    notation: 'compact', maximumFractionDigits: 1,
  }).format(value));
  for (const value of [null, undefined, NaN, Infinity, -Infinity, '123']) {
    assert.equal(fmt(value), '—');
    assert.equal(compact(value), '—');
  }
  assert.equal(fmt(1234567.89), '12,34,567.89');
});
