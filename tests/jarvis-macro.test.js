import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assess, returnSigma, sigmaOf, recentPublishers, coherence,
  MIN_SIGMA, MIN_PUBLISHERS
} from '../agents/jarvis/materiality.mjs';
import { THEMES, themeNames } from '../api/market.js';
import { compose, render, BRIEFS } from '../agents/jarvis/brief.mjs';
import { macro, GLOBAL_CUES } from '../agents/jarvis/agents/macro.mjs';
import { registerAll } from '../agents/jarvis/agents/index.mjs';
import { Registry, ALLOWLISTS } from '../agents/jarvis/registry.mjs';
import { Memory } from '../agents/jarvis/memory.mjs';
import { Bus } from '../agents/jarvis/bus.mjs';
import { instruments, directory, groups } from '../src/data.js';

const NOW = new Date('2026-09-30T06:00:00.000Z');
const roots = [];
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'jarvis-macro-')); roots.push(d); return d; };
after(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });

// A calm baseline: ~0.5% daily sigma.
const CALM = [100, 100.5, 100.1, 100.6, 100.2, 100.7, 100.3, 100.8, 100.4, 100.9,
              100.5, 101.0, 100.6, 101.1, 100.7, 101.2, 100.8, 101.3, 100.9, 101.4];

const news = (sources, at = '2026-09-30T05:30:00.000Z') =>
  sources.map((source, i) => ({
    source, date: at, title: `${source} reports development ${i}`,
    url: `https://example.com/${i}`
  }));

// ---------------------------------------------------------------------------
// Sigma
// ---------------------------------------------------------------------------

test('returnSigma measures daily return dispersion, not price level', () => {
  const sigma = returnSigma(CALM);
  assert.ok(sigma > 0.2 && sigma < 1, `expected a sub-1% sigma, got ${sigma}`);
  // Scaling every price by 10 must not change percentage dispersion.
  assert.ok(Math.abs(returnSigma(CALM.map(x => x * 10)) - sigma) < 1e-9);
});

test('returnSigma returns null rather than a fake number on thin history', () => {
  assert.equal(returnSigma([]), null);
  assert.equal(returnSigma([100]), null);
  assert.equal(returnSigma([100, 101]), null);
  assert.equal(returnSigma([100, 100, 100, 100]), null, 'zero variance is not a usable sigma');
});

test('sigmaOf is null when history is unusable, so the gate cannot pass by accident', () => {
  assert.equal(sigmaOf(5, [100]), null);
  assert.equal(sigmaOf(NaN, CALM), null);
});

// ---------------------------------------------------------------------------
// Condition 1 — THE headline test for this phase
// ---------------------------------------------------------------------------

test('a 0.2% drift with loud coverage stays routine', () => {
  const v = assess({
    theme: 'hormuz', leadChange: 0.2, leadCloses: CALM,
    items: news(['Reuters', 'Bloomberg', 'AP', 'FT']),
    linked: [{ symbol: 'CL=F', sign: 1 }, { symbol: '^CNXENERGY', sign: 1 }],
    quotes: { 'CL=F': { change: 0.3 }, '^CNXENERGY': { change: 0.4 } },
    now: NOW
  });
  assert.equal(v.material, false);
  assert.equal(v.severity, 'routine');
  assert.equal(v.checks.move, false);
  assert.equal(v.checks.publishers, true, 'the press condition genuinely passed');
  assert.equal(v.checks.coherence, true, 'the coherence condition genuinely passed');
  assert.match(v.failed.join(' '), /move:/);
});

test('a large move with only one publisher stays routine', () => {
  const v = assess({
    theme: 'hormuz', leadChange: 4, leadCloses: CALM,
    items: news(['Reuters']),
    linked: [{ symbol: 'CL=F', sign: 1 }],
    quotes: { 'CL=F': { change: 3 } },
    now: NOW
  });
  assert.equal(v.material, false);
  assert.equal(v.checks.move, true);
  assert.equal(v.checks.publishers, false);
});

test('a large move with coverage but incoherent cross-asset action stays routine', () => {
  const v = assess({
    theme: 'hormuz', leadChange: 4, leadCloses: CALM,
    items: news(['Reuters', 'Bloomberg']),
    linked: [{ symbol: 'CL=F', sign: 1 }, { symbol: '^CNXENERGY', sign: 1 }],
    quotes: { 'CL=F': { change: -2 }, '^CNXENERGY': { change: -1 } }, // both against
    now: NOW
  });
  assert.equal(v.material, false);
  assert.equal(v.checks.coherence, false);
});

test('all three conditions met produces a material signal', () => {
  const v = assess({
    theme: 'hormuz', leadChange: 3.8, leadCloses: CALM,
    items: news(['Reuters', 'Bloomberg', 'FT']),
    linked: [{ symbol: 'CL=F', sign: 1 }, { symbol: '^CNXENERGY', sign: 1 }, { symbol: 'INR=X', sign: 1 }],
    quotes: { 'CL=F': { change: 3.1 }, '^CNXENERGY': { change: 1.8 }, 'INR=X': { change: 0.3 } },
    now: NOW
  });
  assert.equal(v.material, true);
  assert.equal(v.severity, 'elevated');
  assert.ok(v.confidence > 0.5 && v.confidence <= 0.9);
  assert.equal(v.failed.length, 0);
});

test('a material but modest move is notable, not elevated', () => {
  const v = assess({
    theme: 'india', leadChange: 1.0, leadCloses: CALM, // ~1.7 sigma
    items: news(['Reuters', 'Mint']),
    linked: [{ symbol: '^NSEBANK', sign: 1 }],
    quotes: { '^NSEBANK': { change: 1.2 } },
    now: NOW
  });
  assert.equal(v.material, true);
  assert.equal(v.severity, 'notable');
});

test('macro observations never reach urgent, whatever the move', () => {
  const v = assess({
    theme: 'hormuz', leadChange: 40, leadCloses: CALM,
    items: news(['Reuters', 'Bloomberg', 'FT', 'AP', 'WSJ']),
    linked: [{ symbol: 'CL=F', sign: 1 }],
    quotes: { 'CL=F': { change: 30 } },
    now: NOW
  });
  assert.equal(v.severity, 'elevated', 'urgent is reserved for position risk and capped at 3/day');
  assert.ok(v.confidence <= 0.9, 'confidence must never claim near-certainty');
});

test('a theme with no linked instrument data fails closed', () => {
  const v = assess({
    theme: 'hormuz', leadChange: 4, leadCloses: CALM,
    items: news(['Reuters', 'Bloomberg']),
    linked: [{ symbol: 'CL=F', sign: 1 }],
    quotes: {}, // no data for the linked instrument
    now: NOW
  });
  assert.equal(v.material, false);
  assert.equal(v.coherence.fraction, null);
  assert.match(v.failed.join(' '), /no linked instrument data/);
});

test('negative moves are judged on magnitude, and coherence flips with the lead', () => {
  const v = assess({
    theme: 'hormuz', leadChange: -3.8, leadCloses: CALM,
    items: news(['Reuters', 'Bloomberg']),
    linked: [{ symbol: 'CL=F', sign: 1 }, { symbol: 'INR=X', sign: 1 }],
    quotes: { 'CL=F': { change: -3.0 }, 'INR=X': { change: -0.4 } },
    now: NOW
  });
  assert.equal(v.material, true, 'a crude collapse is as material as a spike');
  assert.ok(v.sigma < 0);
});

// ---------------------------------------------------------------------------
// Conditions 2 and 3 in isolation
// ---------------------------------------------------------------------------

test('publishers are counted distinctly and only inside the recency window', () => {
  const items = [
    ...news(['Reuters', 'Reuters', 'Bloomberg'], '2026-09-30T05:30:00.000Z'),
    ...news(['FT', 'WSJ'], '2026-09-28T05:30:00.000Z') // outside 6h
  ];
  assert.deepEqual(recentPublishers(items, { now: NOW }).sort(), ['Bloomberg', 'Reuters']);
});

test('an item with an unparseable date is kept rather than silently dropped', () => {
  const items = [{ source: 'Reuters', date: 'not a date', title: 't', url: 'https://x/1' }];
  assert.deepEqual(recentPublishers(items, { now: NOW }), ['Reuters']);
});

test('coherence honours each link sign and abstains without data', () => {
  const linked = [{ symbol: 'A', sign: 1 }, { symbol: 'B', sign: -1 }, { symbol: 'C', sign: 1 }];
  const c = coherence(2, linked, { A: { change: 1 }, B: { change: -1 } }); // C absent
  assert.equal(c.checked, 2, 'an instrument with no quote casts no vote');
  assert.equal(c.agreed, 2, 'B moving down matches its -1 sign against an up lead');
  assert.equal(c.fraction, 1);
});

test('coherence is undecidable when the lead did not move', () => {
  assert.equal(coherence(0, [{ symbol: 'A', sign: 1 }], { A: { change: 2 } }).fraction, null);
});

test('coherence requires a strict majority, so an even split does not confirm', () => {
  const linked = [{ symbol: 'A', sign: 1 }, { symbol: 'B', sign: 1 }];
  const split = coherence(2, linked, { A: { change: 1 }, B: { change: -1 } });
  assert.equal(split.fraction, 0.5);
  assert.equal(split.majority, false, '1 of 2 is a coin flip, not confirmation');

  assert.equal(coherence(2, linked, { A: { change: 1 }, B: { change: 1 } }).majority, true);
  // 2 of 3 is a majority; 1 of 3 is not.
  const three = [...linked, { symbol: 'C', sign: 1 }];
  assert.equal(coherence(2, three, { A: { change: 1 }, B: { change: 1 }, C: { change: -1 } }).majority, true);
  assert.equal(coherence(2, three, { A: { change: 1 }, B: { change: -1 }, C: { change: -1 } }).majority, false);
});

test('an even cross-asset split keeps a big move routine', () => {
  // The live case that prompted this rule: Nikkei +2.16% while KOSPI fell.
  const v = assess({
    theme: 'asia', leadChange: 2.16, leadCloses: CALM,
    items: news(['Bloomberg', 'Reuters', 'Straits Times']),
    linked: [{ symbol: '^KS11', sign: 1 }, { symbol: '^NSEI', sign: 1 }],
    quotes: { '^KS11': { change: -0.10 }, '^NSEI': { change: 0.22 } },
    now: NOW
  });
  assert.equal(v.checks.move, true);
  assert.equal(v.checks.publishers, true);
  assert.equal(v.checks.coherence, false);
  assert.equal(v.material, false);
  assert.match(v.failed.join(' '), /strict majority/);
});

test('thresholds are the documented ones', () => {
  assert.equal(MIN_SIGMA, 1.5);
  assert.equal(MIN_PUBLISHERS, 2);
});

// ---------------------------------------------------------------------------
// Theme configuration (shared with api/market.js)
// ---------------------------------------------------------------------------

test('every theme names a lead, linked instruments and a query', () => {
  assert.ok(themeNames.length >= 3);
  for (const [name, t] of Object.entries(THEMES)) {
    assert.ok(t.lead, `${name} needs a lead`);
    assert.ok(t.linked.length, `${name} needs linked instruments`);
    assert.ok(t.query.length > 10, `${name} needs a query`);
    for (const l of t.linked) {
      assert.ok([1, -1].includes(l.sign), `${name}/${l.symbol} sign must be 1 or -1`);
      assert.notEqual(l.symbol, t.lead, `${name} must not link its own lead`);
    }
  }
});

test('every theme instrument exists in the terminal directory', () => {
  for (const [name, t] of Object.entries(THEMES)) {
    assert.ok(directory.has(t.lead), `${name} lead ${t.lead} missing from data.js`);
    for (const l of t.linked) {
      assert.ok(directory.has(l.symbol), `${name} link ${l.symbol} missing from data.js`);
    }
  }
});

test('the hormuz theme links crude to Indian energy and the rupee', () => {
  const refs = THEMES.hormuz.linked.map(l => l.symbol);
  assert.ok(refs.includes('^CNXENERGY'));
  assert.ok(refs.includes('INR=X'));
  assert.equal(THEMES.hormuz.lead, 'BZ=F');
});

// ---------------------------------------------------------------------------
// KOSPI
// ---------------------------------------------------------------------------

test('KOSPI is in the instrument directory and the Indices group', () => {
  const kospi = instruments.find(x => x.symbol === '^KS11');
  assert.ok(kospi, '^KS11 missing from data.js');
  assert.equal(kospi.name, 'KOSPI');
  assert.ok(groups.Indices.includes('^KS11'));
});

test('KOSPI is among the macro agent global cues', () => {
  assert.ok(GLOBAL_CUES.some(([s]) => s === '^KS11'));
  assert.ok(GLOBAL_CUES.some(([s]) => s === '^N225'), 'Nikkei should sit beside it');
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

test('the macro agent registers within its allowlist', () => {
  const r = registerAll(new Registry());
  assert.ok(r.has('macro'));
  assert.ok(r.has('jarvis'));
  for (const tool of macro.tools) assert.ok(ALLOWLISTS.macro.includes(tool));
});

test('every scheduled agent/intent pair now has a handler or is a known future phase', async () => {
  const { load, SCHEDULE_PATH } = await import('../agents/jarvis/scheduler.mjs');
  const r = registerAll(new Registry());
  const pending = load(SCHEDULE_PATH)
    .filter(rule => !r.handler({ agent: rule.agent, intent: rule.intent }))
    .map(rule => `${rule.agent}/${rule.intent}`);
  // Phases 4, 6 and 7 add momentum, options and errands.
  assert.ok(
    pending.every(p => /^(momentum|options|errands)\//.test(p)),
    `unexpected unhandled rules: ${pending.join(', ')}`
  );
});

test('macro exposes exactly the three scheduled intents', () => {
  assert.deepEqual(
    Object.keys(macro.intents).sort(),
    ['delta_scan', 'geopolitical_scan', 'overnight_wrap']
  );
});

// ---------------------------------------------------------------------------
// Brief composition
// ---------------------------------------------------------------------------

function signalAt(ts, over = {}) {
  return {
    id: `sig_${ts}`, ts, agent: 'macro', kind: 'observation', severity: 'routine',
    title: `at ${ts}`, body: '', subjects: [], evidence: [{ source: 'x', value: 1 }], ...over
  };
}

test('compose keeps only signals inside the window and states the window', () => {
  const brief = compose('overnight', [
    signalAt('2026-09-30T05:00:00.000Z'),                      // 1h ago, in
    signalAt('2026-09-29T10:00:00.000Z')                       // 20h ago, out
  ], { now: NOW });
  assert.equal(brief.total, 1);
  assert.equal(brief.window.hours, BRIEFS.overnight.hours);
  assert.equal(brief.coverage, 'complete');
});

test('an empty window is reported as possible downtime, not as calm markets', () => {
  const brief = compose('overnight', [], { now: NOW });
  assert.match(brief.coverage, /daemon may not have been running/);
  assert.match(render(brief), /daemon may not have been running/);
});

test('compose orders by severity then recency, and collects approvals', () => {
  const brief = compose('close', [
    signalAt('2026-09-30T05:00:00.000Z', { severity: 'routine', title: 'routine one' }),
    signalAt('2026-09-30T05:10:00.000Z', { severity: 'elevated', title: 'elevated one' }),
    signalAt('2026-09-30T05:20:00.000Z', {
      severity: 'notable', title: 'needs sign-off', kind: 'proposal',
      action: { type: 'options_strategy', requiresApproval: true }
    })
  ], { now: NOW });

  assert.equal(brief.signals[0].title, 'elevated one');
  assert.equal(brief.counts.elevated, 1);
  assert.deepEqual(brief.awaiting.map(s => s.title), ['needs sign-off']);
  assert.equal(brief.highlights.length, 2, 'routine signals are not highlights');
});

test('render surfaces highlights and the approval queue', () => {
  const text = render(compose('close', [
    signalAt('2026-09-30T05:10:00.000Z', { severity: 'elevated', title: 'Brent +3.8%' }),
    signalAt('2026-09-30T05:20:00.000Z', {
      severity: 'notable', title: 'Bull call spread', kind: 'proposal',
      action: { type: 'options_strategy', requiresApproval: true }
    })
  ], { now: NOW }));
  assert.match(text, /SESSION CLOSE BRIEF/);
  assert.match(text, /Brent \+3\.8%/);
  assert.match(text, /Awaiting you \(1\)/);
});

test('compose rejects an unknown brief kind', () => {
  assert.throws(() => compose('lunchtime', [], { now: NOW }), /Unknown brief/);
});

// ---------------------------------------------------------------------------
// The agent's own emissions go through the envelope rules
// ---------------------------------------------------------------------------

test('a macro signal built from a verdict satisfies the envelope', () => {
  const store = new Memory(':memory:');
  const bus = new Bus(store, { dir: scratch() });
  const v = assess({
    theme: 'hormuz', leadChange: 3.8, leadCloses: CALM,
    items: news(['Reuters', 'Bloomberg']),
    linked: [{ symbol: 'CL=F', sign: 1 }],
    quotes: { 'CL=F': { change: 3.1 } },
    now: NOW
  });
  const signal = bus.emit({
    agent: 'macro', kind: 'observation', severity: v.severity, confidence: v.confidence,
    title: 'Brent +3.8% on hormuz coverage',
    subjects: [{ type: 'theme', ref: 'hormuz' }, { type: 'instrument', ref: 'BZ=F' }],
    evidence: [
      { source: 'Yahoo Finance via /api/market', value: 87.3, sigma: v.sigma },
      { source: 'Reuters via Google News', url: 'https://example.com/0' }
    ]
  });
  assert.equal(signal.severity, 'elevated');
  assert.equal(signal.evidence.length, 2);
  store.close();
});
