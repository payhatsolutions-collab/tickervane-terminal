// Turns schedule.json into due tasks (blueprint §4.2).
//
// The schedule is data rather than launchd StartCalendarInterval entries, so it
// is testable, hot-reloadable, and survives a move to Vercel Pro unchanged.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCron, matches, nextRun } from './cron.mjs';
import { normalizeTask } from './envelope.mjs';
import { nseSession } from '../../src/marketMath.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCHEDULE_PATH = join(HERE, 'schedule.json');

/** Guards a rule can declare. Unknown guard names fail closed — see load(). */
export const GUARDS = {
  market_open: (now) => nseSession(now).state === 'open',
  market_not_closed: (now) => nseSession(now).state !== 'closed'
};

export function load(path = SCHEDULE_PATH) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('schedule.json must be an array');

  const seen = new Set();
  return raw.map((entry, i) => {
    const where = entry.rule || `entry ${i}`;
    if (!entry.rule) throw new Error(`${where}: rule name is required`);
    if (seen.has(entry.rule)) throw new Error(`Duplicate rule name "${entry.rule}"`);
    seen.add(entry.rule);
    if (entry.guard && !GUARDS[entry.guard]) {
      // Fail at load, not at fire time. A typo'd guard that silently allowed
      // everything would run market agents at 3am for weeks before anyone noticed.
      throw new Error(`${where}: unknown guard "${entry.guard}" (have: ${Object.keys(GUARDS).join(', ')})`);
    }
    return { ...entry, parsed: parseCron(entry.cron) };
  });
}

export class Scheduler {
  constructor({ path = SCHEDULE_PATH, rules = null } = {}) {
    this.rules = rules ?? load(path);
    this.fired = new Map(); // rule -> last fired minute key, prevents double-fire
  }

  /** `2026-09-30T14:15` — minute resolution, the granularity cron works at. */
  static minuteKey(date) { return new Date(date).toISOString().slice(0, 16); }

  /**
   * Rules due at `now`, as validated Task envelopes.
   * Skipping is reported rather than silent: a guard that suppresses a run is
   * information the dashboard should show, not a gap to explain later.
   */
  due(now = new Date()) {
    const key = Scheduler.minuteKey(now);
    const tasks = [];
    const skipped = [];

    for (const rule of this.rules) {
      if (!matches(rule.parsed, now)) continue;
      if (this.fired.get(rule.rule) === key) continue; // already ran this minute
      this.fired.set(rule.rule, key);

      if (rule.guard && !GUARDS[rule.guard](now)) {
        skipped.push({ rule: rule.rule, reason: `guard ${rule.guard} false` });
        continue;
      }
      tasks.push(normalizeTask({
        agent: rule.agent,
        intent: rule.intent,
        params: rule.params || {},
        budget: rule.budget,
        trigger: { kind: 'cron', rule: rule.rule }
      }));
    }

    // Keep the dedupe map from growing without bound across a long-lived daemon.
    if (this.fired.size > 500) this.fired.clear();
    return { tasks, skipped };
  }

  /** Upcoming fire times — `cli.mjs schedule` renders this to sanity-check cron. */
  upcoming(from = new Date(), count = 10) {
    return this.rules
      .map(r => ({ rule: r.rule, agent: r.agent, intent: r.intent, at: nextRun(r.parsed, from) }))
      .filter(x => x.at)
      .sort((a, b) => a.at - b.at)
      .slice(0, count);
  }
}
