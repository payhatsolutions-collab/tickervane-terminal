#!/usr/bin/env node
// Inspection CLI. The daemon is headless until the dashboard lands in phase 3,
// so this is how you see what it is doing.
//
//   node agents/jarvis/cli.mjs signals [--agent macro] [--since ISO] [--limit 20] [--json]
//   node agents/jarvis/cli.mjs health
//   node agents/jarvis/cli.mjs schedule [--count 10]
//   node agents/jarvis/cli.mjs emit '<signal json>'
//   node agents/jarvis/cli.mjs tick            run one scheduler tick now
//   node agents/jarvis/cli.mjs reindex         rebuild SQLite from the JSONL logs
//   node agents/jarvis/cli.mjs prune
import { Memory } from './memory.mjs';
import { Bus } from './bus.mjs';
import { Scheduler } from './scheduler.mjs';
import { Runtime, istDayStart } from './runtime.mjs';
import { compose, render, save, BRIEFS } from './brief.mjs';
import { normalizeTask } from './envelope.mjs';
import { paths, DAILY_TOKEN_BUDGET } from './config.mjs';
import { timeOf } from './ulid.mjs';

const argv = process.argv.slice(2);
const command = argv[0] || 'help';

function flag(name, fallback = undefined) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const C = process.stdout.isTTY
  ? { dim: s => `\x1b[2m${s}\x1b[0m`, bold: s => `\x1b[1m${s}\x1b[0m`,
      red: s => `\x1b[31m${s}\x1b[0m`, yellow: s => `\x1b[33m${s}\x1b[0m`,
      green: s => `\x1b[32m${s}\x1b[0m`, cyan: s => `\x1b[36m${s}\x1b[0m` }
  : new Proxy({}, { get: () => (s => s) });

const SEVERITY_COLOR = {
  routine: C.dim, notable: C.cyan, elevated: C.yellow, urgent: C.red
};

const istTime = iso => new Date(iso).toLocaleTimeString('en-GB', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit'
});

function cmdSignals(store) {
  const list = store.listSignals({
    agent: flag('agent'),
    severity: flag('severity'),
    kind: flag('kind'),
    since: flag('since'),
    limit: Number(flag('limit', 20))
  });
  if (flag('json')) return console.log(JSON.stringify(list, null, 2));
  if (!list.length) return console.log(C.dim('No signals yet.'));

  for (const s of list.reverse()) {
    const colour = SEVERITY_COLOR[s.severity] || (x => x);
    const conf = s.confidence == null ? '' : C.dim(` ${Math.round(s.confidence * 100)}%`);
    console.log(
      `${C.dim(istTime(s.ts))}  ${s.agent.padEnd(8)} ${colour(s.severity.padEnd(8))} ${s.title}${conf}`
    );
    if (s.action?.requiresApproval) {
      console.log(`${' '.repeat(26)}${C.yellow('needs approval')} ${C.dim(s.action.type)}`);
    }
    if (flag('body') && s.body) {
      for (const line of s.body.split('\n')) console.log(`${' '.repeat(26)}${C.dim(line)}`);
    }
    if (flag('evidence')) {
      for (const e of s.evidence) {
        // Lead with the subject (symbol or headline) — "= 0.08" alone tells you
        // nothing about which instrument moved.
        const what = e.symbol ? `${e.symbol} ` : '';
        const value = e.value !== undefined ? `= ${e.value}` : '';
        const extra = [
          e.changePct !== undefined && e.changePct !== null ? `${e.changePct >= 0 ? '+' : ''}${e.changePct}%` : '',
          e.sigma !== undefined && e.sigma !== null ? `${e.sigma}σ` : '',
          e.agreed !== undefined ? (e.agreed ? 'aligned' : 'against') : ''
        ].filter(Boolean).join(' · ');
        const title = e.title ? ` ${C.dim(e.title.slice(0, 60))}` : '';
        console.log(`${' '.repeat(26)}${C.dim('·')} ${what}${value} ${C.dim(e.source)}${extra ? ' ' + C.dim(`(${extra})`) : ''}${title}`);
      }
    }
  }
  console.log(C.dim(`\n${list.length} signal(s). Add --evidence to show provenance.`));
}

function cmdHealth(store) {
  const spend = store.spendSince(istDayStart());
  const pct = Math.round((spend.tokens / DAILY_TOKEN_BUDGET) * 100);
  const bar = '█'.repeat(Math.round(pct / 5)).padEnd(20, '░');
  console.log(C.bold('\nJarvis health'));
  console.log(`  store    ${paths.home}`);
  console.log(`  budget   ${bar} ${spend.tokens.toLocaleString()} / ${DAILY_TOKEN_BUDGET.toLocaleString()} (${pct}%)`);
  console.log(`  today    ${spend.runs} run(s), ${spend.toolCalls} tool call(s)`);

  const health = store.agentHealth();
  console.log(C.bold('\nAgents'));
  if (!health.length) {
    console.log(C.dim('  none have run yet'));
  } else {
    for (const h of health) {
      const mark = h.status === 'ok' ? C.green('●')
        : h.status === 'running' ? C.cyan('◐')
        : h.status === 'skipped' ? C.dim('○') : C.red('●');
      const note = h.error ? C.dim(` — ${h.error}`) : '';
      console.log(`  ${mark} ${h.agent.padEnd(9)} ${h.status.padEnd(8)} ${C.dim(istTime(h.started_at))} ${h.intent}${note}`);
    }
  }
  console.log(C.bold('\nSignals'));
  for (const sev of ['urgent', 'elevated', 'notable', 'routine']) {
    const n = store.countSignalsSince(istDayStart(), { severity: sev });
    if (n) console.log(`  ${(SEVERITY_COLOR[sev] || (x => x))(sev.padEnd(9))} ${n}`);
  }
  console.log('');
}

function cmdSchedule() {
  const scheduler = new Scheduler();
  console.log(C.bold(`\n${scheduler.rules.length} rules · next firings (IST)\n`));
  for (const u of scheduler.upcoming(new Date(), Number(flag('count', 12)))) {
    const when = u.at.toLocaleString('en-GB', {
      timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit'
    });
    console.log(`  ${C.dim(when.padEnd(16))} ${u.rule.padEnd(24)} ${C.dim(`${u.agent}/${u.intent}`)}`);
  }
  console.log('');
}

async function main() {
  if (command === 'help' || command === '--help') {
    console.log(`
${C.bold('jarvis')} — inspection CLI

  signals   [--agent x] [--severity x] [--kind x] [--since ISO] [--limit n] [--evidence] [--body] [--json]
  health    budget, per-agent status, today's signal counts
  schedule  [--count n]   upcoming fire times in IST
  run       <agent> <intent> [--brief overnight] [--seconds n]   run one intent now
  brief     [overnight|close|evening] [--save]
  serve     [--port n]   open the Jarvis dashboard (http://127.0.0.1:7777)
  decide    <signalId> approve|dismiss
  emit      '<signal json>'   validate and publish a signal by hand
  tick      run one scheduler tick immediately
  reindex   rebuild the SQLite index from the JSONL logs
  prune     apply retention (signals 180d, runs 30d)

Agents read market data from JARVIS_MARKET_BASE (default https://alphanova48.in).
Point it at a dev server with: JARVIS_MARKET_BASE=http://localhost:5177
`);
    return;
  }

  const store = new Memory();
  try {
    switch (command) {
      case 'signals': cmdSignals(store); break;
      case 'health': cmdHealth(store); break;
      case 'schedule': cmdSchedule(); break;

      case 'emit': {
        const raw = argv[1];
        if (!raw) throw new Error("Usage: emit '<signal json>'");
        const signal = new Bus(store).emit(JSON.parse(raw));
        console.log(C.green('✓'), signal.id, C.dim(`emitted ${istTime(signal.ts)} IST`));
        break;
      }
      case 'tick': {
        const runtime = new Runtime({ store });
        const result = await runtime.tick();
        console.log(`ran ${result.ran}, skipped ${result.skipped}`);
        break;
      }
      case 'run': {
        // Run one agent intent now, off-schedule. The whole pipeline, same
        // dispatch path, same budget accounting.
        const [, agent, intent] = argv;
        if (!agent || !intent) throw new Error('Usage: run <agent> <intent> [--brief overnight]');
        const runtime = new Runtime({ store });
        const params = flag('brief') ? { brief: flag('brief') } : {};
        const result = await runtime.dispatch(normalizeTask({
          agent, intent, params, trigger: { kind: 'manual' },
          budget: { tokens: 60_000, wallSeconds: Number(flag('seconds', 120)), toolCalls: 60 }
        }));
        if (result.status === 'ok') {
          console.log(C.green('✓'), `${agent}/${intent} — ${result.signals ?? 0} signal(s), ${result.toolCalls ?? 0} tool call(s)`);
        } else {
          console.error(C.red('✗'), `${agent}/${intent} — ${result.status}${result.reason ? `: ${result.reason}` : ''}${result.error ? `: ${result.error}` : ''}`);
          process.exitCode = 1;
        }
        break;
      }
      case 'brief': {
        const kind = argv[1] || 'overnight';
        if (!BRIEFS[kind]) throw new Error(`Unknown brief "${kind}". Try: ${Object.keys(BRIEFS).join(', ')}`);
        const hours = BRIEFS[kind].hours + 2;
        const since = new Date(Date.now() - hours * 3600_000).toISOString();
        const brief = compose(kind, store.listSignals({ since, limit: 500 }));
        console.log(render(brief, { colour: process.stdout.isTTY }));
        if (flag('save')) console.log(C.dim(`saved ${save(brief).latest}`));
        break;
      }
      case 'serve': {
        // The dashboard without the agent loop — useful for looking at what
        // Jarvis has already collected without starting the scheduler.
        const { startDashboard, HOST } = await import('./server.mjs');
        const server = await startDashboard({ store, port: Number(flag('port')) || undefined });
        console.log(C.green('✓'), `Jarvis dashboard on http://${HOST}:${server.address().port}`);
        console.log(C.dim('Ctrl-C to stop. Local only — not reachable from the network.'));
        await new Promise(() => {}); // hold the process open
        break;
      }
      case 'decide': {
        // Also available in the dashboard; both paths run on this machine.
        const [, signalId, decision] = argv;
        if (!signalId || !['approve', 'dismiss'].includes(decision)) {
          throw new Error('Usage: decide <signalId> approve|dismiss');
        }
        const signal = store.getSignal(signalId);
        if (!signal) throw new Error(`No signal ${signalId}`);
        if (!signal.action?.requiresApproval) throw new Error(`${signalId} is not awaiting approval`);
        store.recordDecision(signalId, decision);
        console.log(C.green('✓'), `${signalId} ${decision === 'approve' ? 'approved' : 'dismissed'}`);
        if (decision === 'approve') {
          console.log(C.dim('\nOrder ticket — place this yourself; Jarvis never transmits orders.\n'));
          console.log(JSON.stringify(signal.action.payload, null, 2));
        }
        break;
      }
      case 'reindex': {
        const n = new Bus(store).reindex();
        console.log(C.green('✓'), `reindexed ${n} signal(s) from ${paths.signals}`);
        break;
      }
      case 'prune': {
        const { signals, runs } = store.prune();
        console.log(C.green('✓'), `pruned ${signals} signal(s), ${runs} run(s)`);
        break;
      }
      case 'whenwas': {
        const t = timeOf(argv[1]);
        console.log(t ? t.toISOString() : 'not a ULID');
        break;
      }
      default:
        console.error(`Unknown command "${command}". Try: help`);
        process.exitCode = 1;
    }
  } catch (e) {
    console.error(C.red('✗'), e.message);
    if (e.errors) for (const line of e.errors) console.error(`  · ${line}`);
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

main();
