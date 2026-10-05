import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, matches, nextRun } from '../agents/jarvis/cron.mjs';
import { Scheduler, load, GUARDS, SCHEDULE_PATH } from '../agents/jarvis/scheduler.mjs';
import { Memory } from '../agents/jarvis/memory.mjs';
import { Registry, ALLOWLISTS, FORBIDDEN } from '../agents/jarvis/registry.mjs';
import { Runtime, istDayStart } from '../agents/jarvis/runtime.mjs';
import { Bus } from '../agents/jarvis/bus.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// IST is UTC+5:30, so these UTC instants are chosen to land on known IST times.
const at = iso => new Date(iso);
const IST_0930_WED = at('2026-09-30T04:00:00Z'); // Wed 09:30 IST
const IST_0645_WED = at('2026-09-30T01:15:00Z'); // Wed 06:45 IST
const IST_0630_SUN = at('2026-10-04T01:00:00Z'); // Sun 06:30 IST
const IST_0600_SUN = at('2026-10-04T00:30:00Z'); // Sun 06:00 IST (even hour, minute 0)

// ---------------------------------------------------------------------------
// Cron parsing
// ---------------------------------------------------------------------------

test('parses the field forms the schedule actually uses', () => {
  assert.deepEqual([...parseCron('30 6 * * 1-5').minute], [30]);
  assert.deepEqual([...parseCron('*/15 9-15 * * 1-5').minute], [0, 15, 30, 45]);
  assert.deepEqual([...parseCron('*/15 9-15 * * 1-5').hour], [9, 10, 11, 12, 13, 14, 15]);
  assert.deepEqual([...parseCron('0 */2 * * *').hour], [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
  assert.deepEqual([...parseCron('0,30 9 * * *').minute], [0, 30]);
});

test('treats dow 7 as Sunday', () => {
  assert.ok(parseCron('0 6 * * 7').dow.has(0));
});

test('rejects malformed expressions rather than silently never firing', () => {
  assert.throws(() => parseCron('30 6 * *'), /needs 5 fields/);
  assert.throws(() => parseCron('99 6 * * *'), /out of bounds/);
  assert.throws(() => parseCron('30 6 * * 1-9'), /out of bounds/);
  assert.throws(() => parseCron('*/0 6 * * *'), /Bad step/);
});

// ---------------------------------------------------------------------------
// Matching, in IST
// ---------------------------------------------------------------------------

test('matches a weekday morning rule at the right IST minute', () => {
  assert.equal(matches('30 6 * * 1-5', at('2026-09-30T01:00:00Z')), true);  // 06:30 IST Wed
  assert.equal(matches('30 6 * * 1-5', at('2026-09-30T01:01:00Z')), false); // 06:31 IST
});

test('weekday ranges are evaluated in IST, not UTC', () => {
  // 2026-10-04T19:00Z is Sunday in UTC but already Monday 00:30 IST.
  assert.equal(matches('30 0 * * 1-5', at('2026-10-04T19:00:00Z')), true);
});

test('does not fire a weekday rule on a weekend', () => {
  assert.equal(matches('30 6 * * 1-5', IST_0630_SUN), false);
});

test('a 24x7 rule fires on Sunday', () => {
  assert.equal(matches('0 */2 * * *', IST_0600_SUN), true);   // 06:00 IST, even hour
  assert.equal(matches('0 */2 * * *', IST_0630_SUN), false);  // :30 is not on the hour
});

test('nextRun returns a future instant that matches', () => {
  const next = nextRun('30 6 * * 1-5', IST_0930_WED);
  assert.ok(next > IST_0930_WED);
  assert.equal(matches('30 6 * * 1-5', next), true);
});

// ---------------------------------------------------------------------------
// The shipped schedule
// ---------------------------------------------------------------------------

test('the shipped schedule.json parses and has unique rule names', () => {
  const rules = load(SCHEDULE_PATH);
  assert.ok(rules.length >= 10);
  assert.equal(new Set(rules.map(r => r.rule)).size, rules.length);
});

test('every guard named in the schedule is implemented', () => {
  for (const rule of load(SCHEDULE_PATH)) {
    if (rule.guard) assert.ok(GUARDS[rule.guard], `missing guard ${rule.guard}`);
  }
});

test('an unknown guard fails at load time, not silently at fire time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-sched-'));
  const file = join(dir, 'bad.json');
  writeFileSync(file, JSON.stringify([
    { rule: 'x', cron: '0 9 * * *', agent: 'macro', intent: 'y', guard: 'markt_open' }
  ]));
  assert.throws(() => load(file), /unknown guard/);
  rmSync(dir, { recursive: true, force: true });
});

test('duplicate rule names are rejected', () => {
  const rules = [
    { rule: 'dup', cron: '0 9 * * *', agent: 'macro', intent: 'a' },
    { rule: 'dup', cron: '0 10 * * *', agent: 'macro', intent: 'b' }
  ];
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-sched-'));
  const file = join(dir, 'dup.json');
  writeFileSync(file, JSON.stringify(rules));
  assert.throws(() => load(file), /Duplicate rule/);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Scheduler behaviour
// ---------------------------------------------------------------------------

const rules = [
  { rule: 'always', cron: '* * * * *', agent: 'macro', intent: 'delta_scan' },
  { rule: 'guarded', cron: '* * * * *', agent: 'options', intent: 'monitor', guard: 'market_open' }
];
const mk = () => new Scheduler({ rules: rules.map(r => ({ ...r, parsed: parseCron(r.cron) })) });

test('a rule fires once per minute, not once per tick', () => {
  const s = mk();
  const first = s.due(IST_0630_SUN);
  const second = s.due(IST_0630_SUN);
  assert.equal(first.tasks.some(t => t.trigger.rule === 'always'), true);
  assert.equal(second.tasks.length, 0, 'second tick in the same minute must be a no-op');
});

test('a guarded rule is skipped with a stated reason when the market is closed', () => {
  const { tasks, skipped } = mk().due(IST_0630_SUN); // Sunday: NSE closed
  assert.equal(tasks.some(t => t.trigger.rule === 'guarded'), false);
  assert.deepEqual(skipped.map(s => s.rule), ['guarded']);
  assert.match(skipped[0].reason, /market_open/);
});

test('a guarded rule runs during the open session', () => {
  const { tasks } = mk().due(IST_0930_WED); // Wed 09:30 IST: open
  assert.equal(tasks.some(t => t.trigger.rule === 'guarded'), true);
});

test('due() returns validated task envelopes carrying their trigger', () => {
  const { tasks } = mk().due(IST_0645_WED);
  const task = tasks.find(t => t.trigger.rule === 'always');
  assert.equal(task.agent, 'macro');
  assert.match(task.taskId, /^tsk_/);
  assert.equal(task.budget.tokens, 40_000);
});

// ---------------------------------------------------------------------------
// Registry containment
// ---------------------------------------------------------------------------

test('registry refuses an agent asking for a forbidden tool', () => {
  const r = new Registry();
  assert.throws(
    () => r.register({ name: 'options', tools: ['market', 'kite:place_order'], intents: {} }),
    /forbidden tools/
  );
});

test('registry refuses tools outside the declared allowlist', () => {
  const r = new Registry();
  assert.throws(
    () => r.register({ name: 'macro', tools: ['market', 'gmail:read'], intents: {} }),
    /outside its allowlist/
  );
});

test('no declared allowlist contains a forbidden tool', () => {
  for (const [agent, tools] of Object.entries(ALLOWLISTS)) {
    for (const tool of tools) {
      assert.ok(!FORBIDDEN.includes(tool), `${agent} must not be allowed ${tool}`);
    }
  }
});

test('the options allowlist has no order-placing tool', () => {
  for (const tool of ALLOWLISTS.options) assert.doesNotMatch(tool, /place|modify|cancel/);
});

test('the errands allowlist has no send path', () => {
  for (const tool of ALLOWLISTS.errands) assert.doesNotMatch(tool, /send/);
});

// ---------------------------------------------------------------------------
// Runtime dispatch and budget
// ---------------------------------------------------------------------------

function runtimeFor(registry, store) {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-rt-'));
  const rt = new Runtime({
    store, bus: new Bus(store, { dir }), registry,
    scheduler: mk()
  });
  rt._dir = dir;
  return rt;
}

test('an unregistered intent records a skipped run instead of pretending to work', async () => {
  const store = new Memory(':memory:');
  const rt = runtimeFor(new Registry(), store);
  const result = await rt.dispatch({
    taskId: 'tsk_x', agent: 'macro', intent: 'delta_scan',
    budget: { tokens: 10, wallSeconds: 5, toolCalls: 1 }, trigger: { kind: 'test' }
  });
  assert.equal(result.status, 'skipped');
  assert.equal(store.agentHealth()[0].status, 'skipped');
  rmSync(rt._dir, { recursive: true, force: true });
  store.close();
});

test('a handler exceeding wallSeconds is recorded as a timeout', async () => {
  const store = new Memory(':memory:');
  const registry = new Registry();
  registry.register({
    name: 'macro', tools: ['market'],
    intents: { delta_scan: () => new Promise(r => setTimeout(r, 5000).unref()) }
  });
  const rt = runtimeFor(registry, store);
  const result = await rt.dispatch({
    taskId: 'tsk_slow', agent: 'macro', intent: 'delta_scan',
    budget: { tokens: 10, wallSeconds: 0.05, toolCalls: 1 }, trigger: { kind: 'test' }
  });
  assert.equal(result.status, 'timeout');
  rmSync(rt._dir, { recursive: true, force: true });
  store.close();
});

test('a successful handler records its token and signal counts', async () => {
  const store = new Memory(':memory:');
  const registry = new Registry();
  registry.register({
    name: 'macro', tools: ['market'],
    intents: { delta_scan: async () => ({ tokens: 900, toolCalls: 3, signals: 2 }) }
  });
  const rt = runtimeFor(registry, store);
  await rt.dispatch({
    taskId: 'tsk_ok', agent: 'macro', intent: 'delta_scan',
    budget: { tokens: 5000, wallSeconds: 5, toolCalls: 10 }, trigger: { kind: 'test' }
  });
  assert.equal(store.spendSince(istDayStart()).tokens, 900);
  rmSync(rt._dir, { recursive: true, force: true });
  store.close();
});

test('the budget governor escalates from ok to degraded to critical', async () => {
  const store = new Memory(':memory:');
  const rt = runtimeFor(new Registry(), store);
  assert.equal(rt.budgetState().level, 'ok');

  store.startRun({ taskId: 't1', agent: 'macro', intent: 'x' }, null);
  store.endRun('t1', { status: 'ok', tokens: 420_000 }); // 84%
  assert.equal(rt.budgetState().level, 'degraded');

  store.startRun({ taskId: 't2', agent: 'macro', intent: 'x' }, null);
  store.endRun('t2', { status: 'ok', tokens: 60_000 }); // 96%
  assert.equal(rt.budgetState().level, 'critical');

  rmSync(rt._dir, { recursive: true, force: true });
  store.close();
});

test('critical budget throttles agents but still lets jarvis itself run', () => {
  const store = new Memory(':memory:');
  const rt = runtimeFor(new Registry(), store);
  const critical = { level: 'critical', used: 0.97 };
  assert.ok(rt.throttled({ agent: 'macro', trigger: { rule: 'macro.intraday' } }, critical));
  assert.equal(rt.throttled({ agent: 'jarvis', trigger: { rule: 'jarvis.prune' } }, critical), null);
  rmSync(rt._dir, { recursive: true, force: true });
  store.close();
});

test('degraded budget halves the macro intraday cadence', () => {
  const store = new Memory(':memory:');
  const rt = runtimeFor(new Registry(), store);
  const degraded = { level: 'degraded', used: 0.85 };
  const task = { agent: 'macro', trigger: { rule: 'macro.intraday' } };
  assert.equal(rt.throttled(task, degraded, at('2026-09-30T04:00:00Z')), null);   // :30 IST — kept
  assert.ok(rt.throttled(task, degraded, at('2026-09-30T03:45:00Z')));            // :15 IST — dropped
  rmSync(rt._dir, { recursive: true, force: true });
  store.close();
});

test('urgent escalations are capped per IST day', () => {
  const store = new Memory(':memory:');
  const rt = runtimeFor(new Registry(), store);
  const allowed = [1, 2, 3, 4, 5].map(() => rt.allowUrgent());
  assert.deepEqual(allowed, [true, true, true, false, false]);
  rmSync(rt._dir, { recursive: true, force: true });
  store.close();
});
