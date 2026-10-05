// A minimal 5-field cron matcher, evaluated in IST.
//
// The schedule uses only `*`, `n`, `a-b`, `a,b`, `*/n` and `a-b/n`, so a ~50-line
// parser covers it exactly and keeps the daemon dependency-free. Fields are
// minute hour day-of-month month day-of-week, with dow 0=Sunday (7 also accepted).
import { istParts } from './config.mjs';

const RANGES = {
  minute: [0, 59], hour: [0, 23], dom: [1, 31], month: [1, 12], dow: [0, 6]
};
const FIELDS = ['minute', 'hour', 'dom', 'month', 'dow'];

function parseField(spec, field) {
  const [min, max] = RANGES[field];
  const allowed = new Set();
  for (const part of String(spec).split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad step "${part}" in ${field}`);

    let from, to;
    if (range === '*') {
      [from, to] = [min, max];
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map(Number);
      [from, to] = [a, b];
    } else {
      const n = Number(range);
      from = n;
      // A bare value with a step means "from n to the end", matching cron.
      to = stepRaw === undefined ? n : max;
    }
    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      throw new Error(`Bad range "${part}" in ${field}`);
    }
    if (field === 'dow') { if (from === 7) from = 0; if (to === 7) to = 0; }
    if (from < min || to > max || from > to) {
      throw new Error(`Range "${part}" out of bounds for ${field} (${min}-${max})`);
    }
    for (let v = from; v <= to; v += step) allowed.add(v);
  }
  return allowed;
}

/** Parse a 5-field expression into per-field sets. Throws on malformed input. */
export function parseCron(expr) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Cron needs 5 fields, got ${parts.length}: "${expr}"`);
  }
  const parsed = {};
  FIELDS.forEach((field, i) => { parsed[field] = parseField(parts[i], field); });
  return { expr, ...parsed };
}

/**
 * Does this expression fire at `date` (evaluated in IST)?
 *
 * Follows standard cron's dom/dow rule: when BOTH are restricted the match is a
 * union, not an intersection. None of the current rules restrict both, but
 * getting it wrong silently would be a nasty surprise later.
 */
export function matches(cron, date = new Date()) {
  const c = typeof cron === 'string' ? parseCron(cron) : cron;
  const p = istParts(date);
  if (!c.minute.has(p.minute)) return false;
  if (!c.hour.has(p.hour)) return false;
  if (!c.month.has(p.month)) return false;

  const domAll = c.dom.size === 31;
  const dowAll = c.dow.size === 7;
  const domHit = c.dom.has(p.day);
  const dowHit = c.dow.has(p.dow);
  if (domAll && dowAll) return true;
  if (domAll) return dowHit;
  if (dowAll) return domHit;
  return domHit || dowHit;
}

/**
 * Next firing time at or after `from`, scanning minute by minute.
 * Bounded to one year so an impossible expression (e.g. 31 Feb) terminates.
 */
export function nextRun(cron, from = new Date()) {
  const c = typeof cron === 'string' ? parseCron(cron) : cron;
  const start = new Date(Math.ceil((from.getTime() + 1) / 60_000) * 60_000);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const at = new Date(start.getTime() + i * 60_000);
    if (matches(c, at)) return at;
  }
  return null;
}
