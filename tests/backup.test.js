import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBackup } from '../src/backup.js';
import { describe, runScreen } from '../src/screens.js';

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
