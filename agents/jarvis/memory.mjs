// SQLite memory (blueprint §3.3). Four tables, deliberately small.
//
// `outcomes` is the one that makes the system improve: without it every agent
// restarts cold each day and "learns your preferences" stays marketing copy.
// It is written here in phase 1 even though nothing populates it until phase 9,
// so the schema does not have to change under a running daemon.
import { DatabaseSync } from 'node:sqlite';
import { paths, ensureDirs } from './config.mjs';

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS signals (
  id         TEXT PRIMARY KEY,
  ts         TEXT NOT NULL,
  agent      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  severity   TEXT NOT NULL,
  title      TEXT NOT NULL,
  expires_at TEXT,
  supersedes TEXT,
  json       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS signals_ts    ON signals(ts DESC);
CREATE INDEX IF NOT EXISTS signals_agent ON signals(agent, ts DESC);

-- One row per subject reference, so correlation (§4.3) can find convergence with
-- an index lookup instead of scanning and re-parsing every signal's JSON.
CREATE TABLE IF NOT EXISTS signal_subjects (
  signal_id TEXT NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  type      TEXT NOT NULL,
  ref       TEXT NOT NULL,
  ts        TEXT NOT NULL,
  PRIMARY KEY (signal_id, type, ref)
);
CREATE INDEX IF NOT EXISTS subjects_ref ON signal_subjects(ref, ts DESC);

CREATE TABLE IF NOT EXISTS outcomes (
  id          TEXT PRIMARY KEY,
  signal_id   TEXT NOT NULL,
  decided_at  TEXT,
  decision    TEXT,              -- approved | dismissed | expired
  horizon     TEXT,              -- t1 | t5 | t20
  measured_at TEXT,
  result      TEXT,              -- JSON: realized move, R, notes
  json        TEXT
);
CREATE INDEX IF NOT EXISTS outcomes_signal ON outcomes(signal_id);

CREATE TABLE IF NOT EXISTS preferences (
  key        TEXT PRIMARY KEY,
  value      REAL NOT NULL,
  provenance TEXT,               -- why this weight is what it is
  updated_at TEXT NOT NULL,
  pinned     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS runs (
  task_id     TEXT PRIMARY KEY,
  agent       TEXT NOT NULL,
  intent      TEXT NOT NULL,
  rule        TEXT,
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  status      TEXT NOT NULL,     -- running | ok | error | skipped | timeout
  tokens      INTEGER NOT NULL DEFAULT 0,
  tool_calls  INTEGER NOT NULL DEFAULT 0,
  signals     INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS runs_started ON runs(started_at DESC);
CREATE INDEX IF NOT EXISTS runs_agent   ON runs(agent, started_at DESC);
`;

export class Memory {
  constructor(file = paths.db) {
    if (file !== ':memory:') ensureDirs();
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  close() { this.db.close(); }

  // ---- signals ----------------------------------------------------------

  putSignal(signal) {
    this.db.prepare(
      `INSERT OR REPLACE INTO signals (id, ts, agent, kind, severity, title, expires_at, supersedes, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      signal.id, signal.ts, signal.agent, signal.kind, signal.severity,
      signal.title, signal.expiresAt ?? null, signal.supersedes ?? null,
      JSON.stringify(signal)
    );
    const sub = this.db.prepare(
      `INSERT OR REPLACE INTO signal_subjects (signal_id, type, ref, ts) VALUES (?, ?, ?, ?)`
    );
    for (const s of signal.subjects || []) sub.run(signal.id, s.type, s.ref, signal.ts);
    return signal;
  }

  getSignal(id) {
    const row = this.db.prepare('SELECT json FROM signals WHERE id = ?').get(id);
    return row ? JSON.parse(row.json) : null;
  }

  /** Newest first. `since` is an ISO timestamp, exclusive. */
  listSignals({ since, agent, severity, kind, limit = 100 } = {}) {
    const where = [];
    const args = [];
    if (since) { where.push('ts > ?'); args.push(since); }
    if (agent) { where.push('agent = ?'); args.push(agent); }
    if (severity) { where.push('severity = ?'); args.push(severity); }
    if (kind) { where.push('kind = ?'); args.push(kind); }
    const sql = `SELECT json FROM signals ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY ts DESC, id DESC LIMIT ?`;
    return this.db.prepare(sql).all(...args, Math.min(limit, 1000)).map(r => JSON.parse(r.json));
  }

  /**
   * Signals from other agents that share a subject ref within `windowMinutes`.
   * This is the primitive behind theme convergence (§4.3a).
   */
  relatedSignals(refs, { windowMinutes = 90, excludeAgent, now = new Date() } = {}) {
    if (!refs?.length) return [];
    const from = new Date(now.getTime() - windowMinutes * 60_000).toISOString();
    const marks = refs.map(() => '?').join(',');
    const sql = `SELECT DISTINCT s.json FROM signals s
                 JOIN signal_subjects ss ON ss.signal_id = s.id
                 WHERE ss.ref IN (${marks}) AND s.ts >= ?
                 ${excludeAgent ? 'AND s.agent != ?' : ''}
                 ORDER BY s.ts DESC LIMIT 200`;
    const args = excludeAgent ? [...refs, from, excludeAgent] : [...refs, from];
    return this.db.prepare(sql).all(...args).map(r => JSON.parse(r.json));
  }

  /** Open proposals whose evidence has aged out (§4.3c). */
  staleProposals(now = new Date()) {
    return this.db.prepare(
      `SELECT json FROM signals
       WHERE kind = 'proposal' AND expires_at IS NOT NULL AND expires_at <= ?
       ORDER BY ts DESC LIMIT 100`
    ).all(now.toISOString()).map(r => JSON.parse(r.json));
  }

  countSignalsSince(since, { severity } = {}) {
    const sql = `SELECT COUNT(*) AS n FROM signals WHERE ts >= ?${severity ? ' AND severity = ?' : ''}`;
    const args = severity ? [since, severity] : [since];
    return this.db.prepare(sql).get(...args).n;
  }

  // ---- runs -------------------------------------------------------------

  startRun(task, rule) {
    this.db.prepare(
      `INSERT OR REPLACE INTO runs (task_id, agent, intent, rule, started_at, status)
       VALUES (?, ?, ?, ?, ?, 'running')`
    ).run(task.taskId, task.agent, task.intent, rule ?? null, new Date().toISOString());
    return task.taskId;
  }

  endRun(taskId, { status, tokens = 0, toolCalls = 0, signals = 0, error = null }) {
    this.db.prepare(
      `UPDATE runs SET ended_at = ?, status = ?, tokens = ?, tool_calls = ?, signals = ?, error = ?
       WHERE task_id = ?`
    ).run(new Date().toISOString(), status, tokens, toolCalls, signals, error, taskId);
  }

  /** Token/tool spend since an ISO timestamp — the budget governor's input (§10.3). */
  spendSince(since) {
    const row = this.db.prepare(
      `SELECT COALESCE(SUM(tokens),0) AS tokens, COALESCE(SUM(tool_calls),0) AS toolCalls,
              COUNT(*) AS runs
       FROM runs WHERE started_at >= ?`
    ).get(since);
    return { tokens: row.tokens, toolCalls: row.toolCalls, runs: row.runs };
  }

  /** Last run per agent — powers the dashboard's agent-health column (§5.2). */
  agentHealth() {
    return this.db.prepare(
      `SELECT agent, intent, started_at, ended_at, status, error, signals
       FROM runs r WHERE started_at = (
         SELECT MAX(started_at) FROM runs WHERE agent = r.agent
       ) ORDER BY agent`
    ).all();
  }

  // ---- preferences ------------------------------------------------------

  getPreference(key, fallback = 0) {
    const row = this.db.prepare('SELECT value FROM preferences WHERE key = ?').get(key);
    return row ? row.value : fallback;
  }

  /** Pinned preferences are yours; learning must not overwrite them (§8.3). */
  setPreference(key, value, provenance = '') {
    const row = this.db.prepare('SELECT pinned FROM preferences WHERE key = ?').get(key);
    if (row?.pinned) return false;
    this.db.prepare(
      `INSERT OR REPLACE INTO preferences (key, value, provenance, updated_at, pinned)
       VALUES (?, ?, ?, ?, 0)`
    ).run(key, value, provenance, new Date().toISOString());
    return true;
  }

  pinPreference(key, value) {
    this.db.prepare(
      `INSERT OR REPLACE INTO preferences (key, value, provenance, updated_at, pinned)
       VALUES (?, ?, 'pinned by user', ?, 1)`
    ).run(key, value, new Date().toISOString());
  }

  /**
   * Record what you decided about a proposal. This is the first half of the
   * learning loop (§8.3): phase 9 measures the result at T+1/5/20 and fills in
   * the rest of the row.
   */
  recordDecision(signalId, decision, note = null) {
    this.db.prepare(
      `INSERT OR REPLACE INTO outcomes (id, signal_id, decided_at, decision, json)
       VALUES (?, ?, ?, ?, ?)`
    ).run(`out_${signalId}`, signalId, new Date().toISOString(), decision,
      note ? JSON.stringify({ note }) : null);
    return { signalId, decision };
  }

  decisionFor(signalId) {
    const row = this.db.prepare(
      'SELECT decision, decided_at FROM outcomes WHERE signal_id = ?'
    ).get(signalId);
    return row ? { decision: row.decision, decidedAt: row.decided_at } : null;
  }

  /** Proposals still awaiting a decision — the dashboard's "Awaiting you". */
  pendingApprovals(limit = 20) {
    return this.db.prepare(
      `SELECT s.json FROM signals s
       LEFT JOIN outcomes o ON o.signal_id = s.id
       WHERE s.kind = 'proposal' AND o.decision IS NULL
       ORDER BY s.ts DESC LIMIT ?`
    ).all(limit).map(r => JSON.parse(r.json))
      .filter(s => s.action?.requiresApproval);
  }

  /** Closed-trade count gates the learned score terms (§8.3 cold start). */
  outcomeCount() {
    return this.db.prepare(`SELECT COUNT(*) AS n FROM outcomes WHERE decision IS NOT NULL`).get().n;
  }

  // ---- retention --------------------------------------------------------

  /** Signals 180 days, runs 30. Returns what it removed, for the log. */
  prune(now = new Date()) {
    const cut = days => new Date(now.getTime() - days * 86_400_000).toISOString();
    const signals = this.db.prepare('DELETE FROM signals WHERE ts < ?').run(cut(180)).changes;
    this.db.prepare(
      'DELETE FROM signal_subjects WHERE signal_id NOT IN (SELECT id FROM signals)'
    ).run();
    const runs = this.db.prepare('DELETE FROM runs WHERE started_at < ?').run(cut(30)).changes;
    return { signals, runs };
  }
}

let shared = null;
/** Process-wide handle. Tests construct their own Memory(':memory:') instead. */
export function memory() {
  if (!shared) shared = new Memory();
  return shared;
}
