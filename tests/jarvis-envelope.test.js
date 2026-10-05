import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSignal, normalizeTask, isExpired, EnvelopeError, APPROVAL_REQUIRED_TYPES
} from '../agents/jarvis/envelope.mjs';
import { ulid, timeOf, id } from '../agents/jarvis/ulid.mjs';

const evidence = [{ source: 'Yahoo Finance', value: 87.3, fetchedAt: '2026-09-30T04:00:00.000Z' }];
const base = { agent: 'macro', kind: 'observation', title: 'Brent up', evidence };

// node:assert's throws() returns undefined, so capture the error when a test needs
// to inspect the full error list rather than just match one message.
function caught(fn) {
  try { fn(); return null; } catch (e) { return e; }
}

// ---------------------------------------------------------------------------
// Invariant 1: no evidence, no signal.
// ---------------------------------------------------------------------------

test('rejects a signal with no evidence array', () => {
  assert.throws(() => normalizeSignal({ ...base, evidence: undefined }), EnvelopeError);
});

test('rejects a signal with an empty evidence array', () => {
  const e = caught(() => normalizeSignal({ ...base, evidence: [] }));
  assert.ok(e instanceof EnvelopeError);
  assert.match(e.errors.join(' '), /evidence\[\] is required/);
});

test('rejects evidence that is prose with nothing checkable', () => {
  assert.throws(
    () => normalizeSignal({ ...base, evidence: [{ source: 'analysis', note: 'feels bullish' }] }),
    /needs a value or a url/
  );
});

test('accepts evidence carrying a url instead of a value', () => {
  const s = normalizeSignal({
    ...base, evidence: [{ source: 'Reuters', url: 'https://example.com/a' }]
  });
  assert.equal(s.evidence.length, 1);
});

test('rejects non-https evidence urls', () => {
  assert.throws(
    () => normalizeSignal({ ...base, evidence: [{ source: 'X', url: 'http://insecure.example' }] }),
    /must be https/
  );
});

test('stamps fetchedAt on evidence that omits it', () => {
  const s = normalizeSignal({ ...base, evidence: [{ source: 'Yahoo', value: 1 }] });
  assert.ok(Date.parse(s.evidence[0].fetchedAt));
});

// ---------------------------------------------------------------------------
// Invariant 2: approval cannot be opted out of.
// ---------------------------------------------------------------------------

for (const type of APPROVAL_REQUIRED_TYPES) {
  test(`forces requiresApproval for action type "${type}"`, () => {
    const s = normalizeSignal({
      ...base, kind: 'proposal',
      action: { type, requiresApproval: false, payload: {} }
    });
    assert.equal(s.action.requiresApproval, true);
  });
}

test('an agent omitting requiresApproval entirely still gets it forced', () => {
  const s = normalizeSignal({
    ...base, kind: 'proposal', action: { type: 'equity_order', payload: {} }
  });
  assert.equal(s.action.requiresApproval, true);
});

test('leaves requiresApproval false for a harmless action type', () => {
  const s = normalizeSignal({
    ...base, kind: 'proposal', action: { type: 'refresh_watchlist' }
  });
  assert.equal(s.action.requiresApproval, false);
});

test('a proposal without an action is rejected', () => {
  assert.throws(() => normalizeSignal({ ...base, kind: 'proposal' }), /requires an action/);
});

// ---------------------------------------------------------------------------
// Field validation
// ---------------------------------------------------------------------------

test('rejects an unknown agent', () => {
  assert.throws(() => normalizeSignal({ ...base, agent: 'rogue' }), /agent must be one of/);
});

test('rejects an unknown severity', () => {
  assert.throws(() => normalizeSignal({ ...base, severity: 'catastrophic' }), /severity must be/);
});

test('rejects confidence outside [0,1]', () => {
  assert.throws(() => normalizeSignal({ ...base, confidence: 1.4 }), /confidence must be/);
  assert.throws(() => normalizeSignal({ ...base, confidence: -0.1 }), /confidence must be/);
});

test('rejects an empty title', () => {
  assert.throws(() => normalizeSignal({ ...base, title: '   ' }), /title is required/);
});

test('rejects a subject with an unknown type', () => {
  assert.throws(
    () => normalizeSignal({ ...base, subjects: [{ type: 'vibe', ref: 'x' }] }),
    /subjects\[0\].type must be/
  );
});

test('reports every problem at once, not just the first', () => {
  const e = caught(() => normalizeSignal({ agent: 'nope', kind: 'bad', title: '', evidence: [] }));
  assert.ok(e instanceof EnvelopeError);
  assert.ok(e.errors.length >= 4, `expected several errors, got ${e.errors.length}`);
});

test('defaults severity to routine and fills id and ts', () => {
  const s = normalizeSignal(base);
  assert.equal(s.severity, 'routine');
  assert.match(s.id, /^sig_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(Date.parse(s.ts));
});

test('preserves an explicit id so replay keeps identity', () => {
  const s = normalizeSignal({ ...base, id: 'sig_FIXED' });
  assert.equal(s.id, 'sig_FIXED');
});

// ---------------------------------------------------------------------------
// Expiry, tasks, ulid
// ---------------------------------------------------------------------------

test('isExpired tracks expiresAt, and is false when unset', () => {
  const now = new Date('2026-09-30T10:00:00Z');
  assert.equal(isExpired({ expiresAt: '2026-09-30T09:00:00Z' }, now), true);
  assert.equal(isExpired({ expiresAt: '2026-09-30T11:00:00Z' }, now), false);
  assert.equal(isExpired({}, now), false);
});

test('task envelope applies default budgets and generates an id', () => {
  const t = normalizeTask({ agent: 'options', intent: 'scan_monthly_expiry' });
  assert.equal(t.budget.tokens, 40_000);
  assert.equal(t.budget.wallSeconds, 120);
  assert.match(t.taskId, /^tsk_/);
  assert.deepEqual(t.context, []);
});

test('task envelope rejects a non-positive budget', () => {
  assert.throws(
    () => normalizeTask({ agent: 'macro', intent: 'x', budget: { tokens: 0 } }),
    /budget.tokens must be/
  );
});

test('ulids sort chronologically and stay ordered within one millisecond', () => {
  const now = Date.now();
  const batch = Array.from({ length: 50 }, () => ulid(now));
  assert.deepEqual([...batch].sort(), batch, 'same-ms ulids must be monotonic');
  assert.ok(ulid(now) < ulid(now + 1000));
});

test('timeOf recovers the emission time from a prefixed id', () => {
  const before = Date.now();
  const recovered = timeOf(id('sig')).getTime();
  assert.ok(Math.abs(recovered - before) < 2000);
});
