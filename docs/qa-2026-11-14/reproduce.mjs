// Diagnostic reproductions of the two QA findings, not regression expectations.
// Run from the repository: node docs/qa-2026-11-14/reproduce.mjs
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runScreen } from '../../src/screens.js';
import { parseBackup } from '../../src/backup.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const screen = { when: [['above200', 'is', false]] };
assert.equal(runScreen([{ symbol: 'UNKNOWN', above200: null }], screen).length, 1);
assert.equal(runScreen([{ symbol: 'KNOWN_FALSE', above200: false }], screen).length, 1);
assert.equal(runScreen([{ symbol: 'KNOWN_TRUE', above200: true }], screen).length, 0);
const snapshot = JSON.parse(await readFile(join(root, 'content/stock-snapshot.json'), 'utf8'));
const unknown = snapshot.screen.rows.filter(row => row.above200 == null);
console.log('CONFIRMED: a missing above200 value incorrectly matches Above 200 DMA = No.');
console.log(JSON.stringify({ session: snapshot.screen.date, affected: runScreen(unknown, screen).map(row => row.symbol) }));

const temp = await mkdtemp(join(tmpdir(), 'alphanova-qa-journal-'));
try {
  const outfile = join(temp, 'journal.cjs');
  await build({
    stdin: { contents: "export {TradeJournal} from './src/TradeDesk.jsx'", resolveDir: root, loader: 'jsx' },
    outfile, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    define: { 'import.meta.env.VITE_KITE_PUBLISHER_KEY': '""' }, loader: { '.css': 'empty' },
    plugins: [{ name: 'shared-react', setup(builder) {
      builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: require.resolve(args.path), external: true }));
    } }],
  });
  const { TradeJournal } = require(outfile);
  const entry = { id: 'qa-only', symbol: 'TCS.NS', currency: 'INR', side: 'long', status: 'planned',
    entry: 100, stop: 90, target: 120, quantity: 1, plannedRisk: 10,
    createdAt: '2026-11-14T00:00:00Z', notes: 'Valid note' };
  const render = journal => renderToStaticMarkup(React.createElement(TradeJournal, {
    entries: journal, setEntries() {}, onOpen() {}, onPlan() {}, exportCSV() {}, notify() {},
  }));
  assert.doesNotThrow(() => render([entry]));
  for (const field of ['notes', 'review']) {
    const parsed = parseBackup({ app: 'alphanova-terminal', version: 5,
      data: { watch: [], positions: [], alerts: [], journal: [{ ...entry, [field]: { text: 'Malformed note' } }] } });
    assert.equal(parsed.journal.length, 1);
    assert.throws(() => render(parsed.journal), /Objects are not valid as a React child/);
    console.log(`CONFIRMED: backup accepts object-valued ${field}; TradeJournal then throws a React render error.`);
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
