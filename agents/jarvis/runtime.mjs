// The Jarvis daemon: the only long-lived process (blueprint §1, §4).
//
// It schedules, delegates, enforces budgets and logs. It does not fetch data,
// analyze charts or write drafts — those belong to sub-agents, which phase 2
// onward register into the Registry.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { Memory } from './memory.mjs';
import { Bus } from './bus.mjs';
import { Scheduler } from './scheduler.mjs';
import { Registry } from './registry.mjs';
import { registerAll } from './agents/index.mjs';
import { paths, ensureDirs, istParts, DAILY_TOKEN_BUDGET, URGENT_DAILY_CAP } from './config.mjs';

const TICK_MS = Number(process.env.JARVIS_TICK_MS) || 20_000;

export function log(level, event, data = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
  if (level === 'error') console.error(line); else console.log(line);
  try {
    appendFileSync(join(paths.logs, `jarvis-${istParts().date}.jsonl`), line + '\n');
  } catch { /* logging must never take the daemon down */ }
}

/** Start of the current IST day, as UTC ISO — the window budgets and caps reset on. */
export function istDayStart(now = new Date()) {
  const p = istParts(now);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, 0, 0) - 5.5 * 3600_000).toISOString();
}

export class Runtime {
  constructor({ store, bus, scheduler, registry, dashboard = true } = {}) {
    ensureDirs();
    this.dashboard = dashboard;
    this.server = null;
    this.store = store ?? new Memory();
    this.bus = bus ?? new Bus(this.store);
    this.scheduler = scheduler ?? new Scheduler();
    // Tests pass their own registry; the daemon gets every implemented agent.
    this.registry = registry ?? registerAll(new Registry());
    this.timer = null;
    this.running = false;
    this.stopping = false;
    this.urgentToday = { date: istParts().date, count: 0 };
  }

  /**
   * Budget governor (§10.3). Degrades cadence rather than stopping dead: at 80%
   * the 15-minute macro scan drops to 30 minutes, at 95% only urgent work runs.
   */
  budgetState(now = new Date()) {
    const { tokens } = this.store.spendSince(istDayStart(now));
    const used = tokens / DAILY_TOKEN_BUDGET;
    const level = used >= 0.95 ? 'critical' : used >= 0.8 ? 'degraded' : 'ok';
    return { tokens, budget: DAILY_TOKEN_BUDGET, used, level };
  }

  /** Rules the governor suppresses at the current spend level. */
  throttled(task, budget, now = new Date()) {
    if (budget.level === 'ok') return null;
    const rule = task.trigger?.rule ?? '';
    if (budget.level === 'critical' && task.agent !== 'jarvis') {
      return `budget critical (${Math.round(budget.used * 100)}%)`;
    }
    if (budget.level === 'degraded' && rule === 'macro.intraday') {
      // Halve the cadence: keep the half-hour marks, drop the quarter ones.
      if (istParts(now).minute % 30 !== 0) return `budget degraded (${Math.round(budget.used * 100)}%)`;
    }
    return null;
  }

  /** Urgent escalations are capped per IST day; the cap is the point (§4.4). */
  allowUrgent(now = new Date()) {
    const today = istParts(now).date;
    if (this.urgentToday.date !== today) this.urgentToday = { date: today, count: 0 };
    if (this.urgentToday.count >= URGENT_DAILY_CAP) return false;
    this.urgentToday.count++;
    return true;
  }

  async dispatch(task, { rule = task.trigger?.rule } = {}) {
    const handler = this.registry.handler(task);
    this.store.startRun(task, rule);

    if (!handler) {
      // Honest no-op. Phase 1 has no agents registered, and a daemon that
      // pretends to have run something it cannot is worse than one that says so.
      this.store.endRun(task.taskId, { status: 'skipped', error: 'no handler registered' });
      log('warn', 'task.unhandled', { taskId: task.taskId, agent: task.agent, intent: task.intent });
      return { status: 'skipped', reason: 'no handler registered' };
    }

    const started = Date.now();
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Exceeded wallSeconds=${task.budget.wallSeconds}`)),
        task.budget.wallSeconds * 1000).unref()
    );

    try {
      const result = await Promise.race([
        handler({ task, bus: this.bus, store: this.store, runtime: this }),
        timeout
      ]);
      const signals = result?.signals ?? 0;
      this.store.endRun(task.taskId, {
        status: 'ok', tokens: result?.tokens ?? 0,
        toolCalls: result?.toolCalls ?? 0, signals
      });
      log('info', 'task.ok', {
        taskId: task.taskId, agent: task.agent, intent: task.intent,
        ms: Date.now() - started, signals, tokens: result?.tokens ?? 0
      });
      return { status: 'ok', ...result };
    } catch (e) {
      const timedOut = /Exceeded wallSeconds/.test(e.message);
      this.store.endRun(task.taskId, {
        status: timedOut ? 'timeout' : 'error', error: e.message
      });
      log('error', 'task.failed', {
        taskId: task.taskId, agent: task.agent, intent: task.intent,
        ms: Date.now() - started, error: e.message
      });
      return { status: timedOut ? 'timeout' : 'error', error: e.message };
    }
  }

  /**
   * Serve the dashboard from this process. Nothing is published anywhere: the
   * dashboard reads the daemon's own store over loopback, so Jarvis does not
   * depend on any website being up and nothing about it is public.
   */
  async serve() {
    const { startDashboard, PORT, HOST } = await import('./server.mjs');
    try {
      this.server = await startDashboard({ store: this.store });
      log('info', 'dashboard.listening', { url: `http://${HOST}:${this.server.address().port}` });
    } catch (e) {
      // A port clash must not take the agent loop down with it.
      log('error', 'dashboard.failed', { error: e.message, port: PORT });
    }
    return this.server;
  }

  async tick(now = new Date()) {
    const { tasks, skipped } = this.scheduler.due(now);
    for (const s of skipped) log('info', 'task.guarded', s);
    if (!tasks.length) return { ran: 0, skipped: skipped.length };

    const budget = this.budgetState(now);
    let ran = 0;
    for (const task of tasks) {
      const throttle = this.throttled(task, budget, now);
      if (throttle) {
        this.store.startRun(task, task.trigger?.rule);
        this.store.endRun(task.taskId, { status: 'skipped', error: throttle });
        log('warn', 'task.throttled', { taskId: task.taskId, rule: task.trigger?.rule, reason: throttle });
        continue;
      }
      await this.dispatch(task);
      ran++;
    }
    // Nothing to publish: the dashboard reads this same store directly.
    return { ran, skipped: skipped.length + (tasks.length - ran) };
  }

  start() {
    if (this.running) return this;
    this.running = true;
    if (this.dashboard) this.serve();
    const loop = async () => {
      if (this.stopping) return;
      try { await this.tick(); } catch (e) { log('error', 'tick.failed', { error: e.message }); }
      if (!this.stopping) this.timer = setTimeout(loop, TICK_MS);
    };
    log('info', 'daemon.start', {
      tickMs: TICK_MS, rules: this.scheduler.rules.length,
      agents: this.registry.names(), home: paths.home
    });
    this.timer = setTimeout(loop, 0);
    return this;
  }

  async stop() {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.server) await new Promise(r => this.server.close(r));
    this.running = false;
    log('info', 'daemon.stop', {});
    this.store.close();
  }
}

// Only start when executed directly, so tests and the CLI can import freely.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const runtime = new Runtime().start();
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => { runtime.stop().then(() => process.exit(0)); });
  }
  process.on('uncaughtException', e => log('error', 'uncaught', { error: e.message, stack: e.stack }));
  process.on('unhandledRejection', e => log('error', 'unhandled', { error: String(e) }));
}
