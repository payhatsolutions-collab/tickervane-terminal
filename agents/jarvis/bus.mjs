// The signal bus (blueprint §3.1).
//
// Two stores, on purpose:
//   · JSONL under ~/.alphanova/signals/ is the durable, append-only record. It
//     survives a corrupted database, is greppable, and is what `replay` reads.
//   · SQLite is the query index. Rebuildable from the JSONL at any time.
//
// Every write goes through normalizeSignal(), so the evidence rule and the
// approval override cannot be bypassed by an agent writing "directly to the bus".
import { appendFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeSignal } from './envelope.mjs';
import { paths, istParts } from './config.mjs';
import { memory } from './memory.mjs';

const logFileFor = (date = new Date()) => join(paths.signals, `${istParts(date).date}.jsonl`);

export class Bus {
  /** @param {import('./memory.mjs').Memory} store */
  constructor(store = memory(), { dir = paths.signals } = {}) {
    this.store = store;
    this.dir = dir;
    this.listeners = new Set();
    // Only the directory this bus will actually write to. Creating the default
    // store as a side effect would surprise any caller that passed a `dir`,
    // including every test.
    mkdirSync(this.dir, { recursive: true });
  }

  /**
   * Validate, persist and publish a signal.
   * Throws EnvelopeError when the envelope is invalid — notably when evidence[]
   * is empty. Callers are expected to let that throw: a signal an agent could
   * not substantiate is a bug in the agent, not a condition to swallow.
   */
  emit(input) {
    const signal = normalizeSignal(input);
    appendFileSync(join(this.dir, `${istParts(new Date(signal.ts)).date}.jsonl`),
      JSON.stringify(signal) + '\n');
    this.store.putSignal(signal);
    for (const fn of this.listeners) {
      try { fn(signal); } catch { /* a bad subscriber must not break the emitter */ }
    }
    return signal;
  }

  /**
   * Emit without throwing. For agent code paths where one malformed signal
   * should not abort a batch of otherwise-good ones. Returns {ok, signal|errors}.
   */
  tryEmit(input) {
    try {
      return { ok: true, signal: this.emit(input) };
    } catch (e) {
      return { ok: false, errors: e.errors || [e.message] };
    }
  }

  /** Subscribe to new signals (Jarvis's correlation and escalation hooks). */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  list(query) { return this.store.listSignals(query); }
  get(id) { return this.store.getSignal(id); }
  related(refs, opts) { return this.store.relatedSignals(refs, opts); }
  stale(now) { return this.store.staleProposals(now); }

  /** Read one IST day straight from the durable log, bypassing SQLite. */
  readDay(date = new Date()) {
    const file = logFileFor(date);
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  }

  /**
   * Rebuild the SQLite index from the JSONL logs. The logs are the source of
   * truth, so a lost or corrupt database is a recoverable event, not data loss.
   */
  reindex() {
    let count = 0;
    for (const file of readdirSync(this.dir).filter(f => f.endsWith('.jsonl')).sort()) {
      for (const line of readFileSync(join(this.dir, file), 'utf8').split('\n')) {
        if (!line) continue;
        try { this.store.putSignal(JSON.parse(line)); count++; } catch { /* skip bad line */ }
      }
    }
    return count;
  }
}

let shared = null;
export function bus() {
  if (!shared) shared = new Bus();
  return shared;
}
