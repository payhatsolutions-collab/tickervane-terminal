import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Memory } from '../agents/jarvis/memory.mjs';
import { Bus } from '../agents/jarvis/bus.mjs';
import { istParts } from '../agents/jarvis/config.mjs';

const roots = [];
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-bus-'));
  roots.push(dir);
  return dir;
}
after(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });

const evidence = [{ source: 'Yahoo Finance', value: 87.3 }];
const signal = (over = {}) => ({
  agent: 'macro', kind: 'observation', title: 'Brent up', evidence, ...over
});

let store, dir, bus;
beforeEach(() => {
  store = new Memory(':memory:');
  dir = scratch();
  bus = new Bus(store, { dir });
});

test('a bus given its own dir does not create the default store', () => {
  const home = scratch();
  const before = existsSync(join(home, 'signals'));
  new Bus(new Memory(':memory:'), { dir: join(home, 'custom') }).emit(signal());
  assert.equal(existsSync(join(home, 'custom')), true);
  assert.equal(existsSync(join(home, 'signals')), before, 'must not create sibling store dirs');
});

test('emit persists to both the JSONL log and the query index', () => {
  const s = bus.emit(signal());
  const file = join(dir, `${istParts(new Date(s.ts)).date}.jsonl`);
  assert.ok(existsSync(file), 'durable log file should exist');
  assert.equal(JSON.parse(readFileSync(file, 'utf8').trim()).id, s.id);
  assert.equal(store.getSignal(s.id).title, 'Brent up');
});

test('emit throws on an evidence-less signal and writes nothing', () => {
  assert.throws(() => bus.emit(signal({ evidence: [] })));
  assert.equal(store.listSignals().length, 0);
  assert.equal(bus.readDay().length, 0, 'a rejected signal must not reach the durable log');
});

test('tryEmit reports errors instead of throwing, so one bad signal cannot abort a batch', () => {
  const bad = bus.tryEmit(signal({ evidence: [] }));
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(' '), /evidence/);

  const good = bus.tryEmit(signal());
  assert.equal(good.ok, true);
  assert.equal(store.listSignals().length, 1);
});

test('subscribers receive emitted signals, and a throwing subscriber cannot break emit', () => {
  const seen = [];
  bus.subscribe(() => { throw new Error('subscriber exploded'); });
  bus.subscribe(s => seen.push(s.id));
  const s = bus.emit(signal());
  assert.deepEqual(seen, [s.id]);
});

test('unsubscribe stops delivery', () => {
  const seen = [];
  const off = bus.subscribe(s => seen.push(s.id));
  bus.emit(signal());
  off();
  bus.emit(signal({ title: 'Second' }));
  assert.equal(seen.length, 1);
});

test('list filters by agent, severity and kind, newest first', () => {
  bus.emit(signal({ title: 'A', ts: '2026-09-30T04:00:00.000Z' }));
  bus.emit(signal({ title: 'B', agent: 'momentum', severity: 'notable', ts: '2026-09-30T05:00:00.000Z' }));
  bus.emit(signal({ title: 'C', agent: 'momentum', severity: 'elevated', ts: '2026-09-30T06:00:00.000Z' }));

  assert.deepEqual(bus.list({ agent: 'momentum' }).map(s => s.title), ['C', 'B']);
  assert.deepEqual(bus.list({ severity: 'elevated' }).map(s => s.title), ['C']);
  assert.deepEqual(bus.list({ since: '2026-09-30T05:30:00.000Z' }).map(s => s.title), ['C']);
});

test('related() finds cross-agent convergence on a shared subject inside the window', () => {
  const now = new Date('2026-09-30T06:00:00.000Z');
  bus.emit(signal({
    agent: 'macro', title: 'Brent spike', ts: '2026-09-30T05:30:00.000Z',
    subjects: [{ type: 'sector', ref: '^CNXENERGY' }]
  }));
  bus.emit(signal({
    agent: 'momentum', title: 'ONGC top decile', ts: '2026-09-30T05:45:00.000Z',
    subjects: [{ type: 'sector', ref: '^CNXENERGY' }]
  }));

  const hits = bus.related(['^CNXENERGY'], { windowMinutes: 90, excludeAgent: 'macro', now });
  assert.deepEqual(hits.map(s => s.agent), ['momentum']);
});

test('related() ignores signals older than the window', () => {
  const now = new Date('2026-09-30T06:00:00.000Z');
  bus.emit(signal({
    agent: 'momentum', title: 'Yesterday', ts: '2026-09-29T06:00:00.000Z',
    subjects: [{ type: 'sector', ref: '^CNXENERGY' }]
  }));
  assert.equal(bus.related(['^CNXENERGY'], { windowMinutes: 90, now }).length, 0);
});

test('stale() surfaces expired proposals for re-validation', () => {
  const now = new Date('2026-09-30T10:00:00.000Z');
  bus.emit(signal({
    kind: 'proposal', agent: 'options', title: 'Expired spread',
    action: { type: 'options_strategy' }, expiresAt: '2026-09-30T09:00:00.000Z'
  }));
  bus.emit(signal({
    kind: 'proposal', agent: 'options', title: 'Live spread',
    action: { type: 'options_strategy' }, expiresAt: '2026-09-30T11:00:00.000Z'
  }));
  assert.deepEqual(bus.stale(now).map(s => s.title), ['Expired spread']);
});

test('reindex rebuilds the query index from the durable log', () => {
  bus.emit(signal({ title: 'One' }));
  bus.emit(signal({ title: 'Two' }));

  const rebuilt = new Memory(':memory:');
  const count = new Bus(rebuilt, { dir }).reindex();
  assert.equal(count, 2);
  assert.deepEqual(rebuilt.listSignals().map(s => s.title).sort(), ['One', 'Two']);
  rebuilt.close();
});

test('budget spend and agent health aggregate from runs', () => {
  const task = { taskId: 'tsk_1', agent: 'macro', intent: 'delta_scan' };
  store.startRun(task, 'macro.intraday');
  store.endRun('tsk_1', { status: 'ok', tokens: 1200, toolCalls: 4, signals: 2 });

  const spend = store.spendSince('2000-01-01T00:00:00.000Z');
  assert.equal(spend.tokens, 1200);
  assert.equal(spend.toolCalls, 4);

  const health = store.agentHealth();
  assert.equal(health.length, 1);
  assert.equal(health[0].status, 'ok');
});

test('pinned preferences survive a learning write', () => {
  store.pinPreference('sector_affinity.financials', 12);
  assert.equal(store.setPreference('sector_affinity.financials', 3, 'EWMA'), false);
  assert.equal(store.getPreference('sector_affinity.financials'), 12);
});

test('prune drops signals past retention and keeps recent ones', () => {
  const now = new Date('2026-09-30T00:00:00.000Z');
  const old = new Date(now.getTime() - 200 * 86_400_000).toISOString();
  bus.emit(signal({ title: 'Ancient', ts: old }));
  bus.emit(signal({ title: 'Recent', ts: now.toISOString() }));

  const { signals } = store.prune(now);
  assert.equal(signals, 1);
  assert.deepEqual(store.listSignals().map(s => s.title), ['Recent']);
});
