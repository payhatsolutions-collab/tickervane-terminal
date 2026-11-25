import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBackup } from '../src/backup.js';
import { describe, runScreen } from '../src/screens.js';
import { fmt } from '../src/format.js';

test('restored screens can be displayed and applied after malformed rules are removed', () => {
  const restored = parseBackup(JSON.stringify({
    watch: [], positions: [], alerts: [],
    savedScreens: [
      { name: 'Broken', when: [null] },
      { id: 'custom', name: 'Low RSI', industry: 'IT', when: [null, ['rsi', 'max', '40']] },
    ],
  }));
  const rows = [
    { symbol: 'TCS', industry: 'IT', rsi: 35 },
    { symbol: 'INFY', industry: 'IT', rsi: 60 },
    { symbol: 'OTHER', industry: 'Bank', rsi: 30 },
  ];
  assert.deepEqual(restored.savedScreens.map(screen => ({
    name: screen.name,
    description: describe(screen.when),
    matches: runScreen(rows, screen).map(row => row.symbol),
  })), [{ name: 'Low RSI', description: 'RSI 14 ≤ 40', matches: ['TCS'] }]);
});

test('backup records reject malformed values and normalize numeric strings for display', () => {
  const restored = parseBackup({
    symbol: {}, watch: [null, ' tcs.ns ', 'TCS.NS', {}, '../bad'],
    positions: [null, { symbol: 'TCS.NS', quantity: '2', cost: '100', currency: 'INR' },
      { symbol: 'BAD', quantity: 'Infinity', cost: 1 }, { symbol: 'BAD', quantity: true, cost: 1 }],
    alerts: [null, { symbol: 'TCS.NS', price: '101', condition: 'above', created: '123' },
      { symbol: 'BAD', price: 'Infinity', condition: 'above' }],
    deliveryHistory: [null, 1, { symbol: {}, at: '2026-11-01' },
      { symbol: 'TCS.NS', at: '2026-11-01T12:00:00Z', condition: { invalid: true }, target: '100' }],
  });
  assert.equal(restored.symbol, null);
  assert.deepEqual(restored.watch, ['TCS.NS']);
  assert.equal(restored.positions.length, 1);
  assert.equal(fmt(restored.positions[0].quantity), '2.00');
  assert.equal(restored.alerts.length, 1);
  assert.equal(restored.alerts[0].price, 101);
  assert.equal(restored.alerts[0].created, 123);
  assert.equal(restored.deliveryHistory.length, 1);
  assert.equal(restored.deliveryHistory[0].condition, undefined);
  assert.doesNotThrow(() => restored.deliveryHistory.filter(h => h.at).map(h => h.symbol.replace('.NS', '')));
});

test('null and unrelated JSON give a useful backup error', () => {
  for (const value of [null, 'null', {}, [], 42]) assert.throws(() => parseBackup(value), /Alpha Nova backup/);
});

test('backup restoration preserves provider currency units such as British pence', () => {
  const restored = parseBackup({ watch: [], alerts: [], positions: [{ symbol: 'VOD.L', quantity: 2, cost: 100, currency: 'GBp' }] });
  assert.equal(restored.positions[0].currency, 'GBp');
});
