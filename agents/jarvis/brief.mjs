// Brief composition (blueprint §4.5). Three per day, folded out of the signal bus.
//
// Every brief states its coverage window explicitly. That is not decoration: the
// daemon skips ticks while the Mac is asleep, and a brief that silently omitted
// 02:00-06:00 would read as calm markets rather than as missing data.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { paths, istParts, TZ } from './config.mjs';

export const BRIEFS = {
  overnight: {
    label: 'Overnight',
    hours: 15,           // back to roughly the previous session's close
    blurb: 'US close, Asia open, commodities and the geopolitical delta.'
  },
  close: {
    label: 'Session close',
    hours: 7,            // pre-open through the close
    blurb: 'What the session did against the morning read.'
  },
  evening: {
    label: 'Personal + EOD',
    hours: 4,
    blurb: 'Delivery radar, tomorrow, bills and mail awaiting you.'
  }
};

const SEVERITY_RANK = { urgent: 0, elevated: 1, notable: 2, routine: 3 };
const istTime = iso => new Date(iso).toLocaleTimeString('en-GB', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit'
});

/**
 * Fold the signals in a brief's window into a structured brief.
 * Pure apart from reading the clock, so it is testable against fixtures.
 */
export function compose(kind, signals, { now = new Date() } = {}) {
  const spec = BRIEFS[kind];
  if (!spec) throw new Error(`Unknown brief "${kind}". Try: ${Object.keys(BRIEFS).join(', ')}`);

  const from = new Date(now.getTime() - spec.hours * 3600_000);
  const inWindow = (signals || [])
    .filter(s => Date.parse(s.ts) >= from.getTime())
    .sort((a, b) =>
      (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) || (Date.parse(b.ts) - Date.parse(a.ts))
    );

  const byAgent = {};
  for (const s of inWindow) (byAgent[s.agent] ??= []).push(s);

  const counts = { urgent: 0, elevated: 0, notable: 0, routine: 0 };
  for (const s of inWindow) counts[s.severity]++;

  const awaiting = inWindow.filter(s => s.action?.requiresApproval);

  return {
    kind,
    label: spec.label,
    blurb: spec.blurb,
    generatedAt: now.toISOString(),
    date: istParts(now).date,
    window: { from: from.toISOString(), to: now.toISOString(), hours: spec.hours },
    counts,
    total: inWindow.length,
    // An empty window is stated, not hidden. Most likely cause is the daemon not
    // running, which is exactly what the reader needs to know.
    coverage: inWindow.length
      ? 'complete'
      : `no signals in the ${spec.hours}h window — daemon may not have been running`,
    highlights: inWindow.filter(s => s.severity !== 'routine').slice(0, 8),
    awaiting,
    byAgent,
    signals: inWindow
  };
}

/** Terminal rendering — phase 2's deliverable is this brief on stdout. */
export function render(brief, { colour = false } = {}) {
  const C = colour
    ? { dim: s => `\x1b[2m${s}\x1b[0m`, bold: s => `\x1b[1m${s}\x1b[0m`,
        yellow: s => `\x1b[33m${s}\x1b[0m`, red: s => `\x1b[31m${s}\x1b[0m`,
        cyan: s => `\x1b[36m${s}\x1b[0m` }
    : new Proxy({}, { get: () => (s => s) });
  const mark = { urgent: C.red('!!'), elevated: C.yellow(' !'), notable: C.cyan(' ·'), routine: C.dim('  ') };

  const out = [];
  out.push('');
  out.push(C.bold(`${brief.label.toUpperCase()} BRIEF  ${brief.date}`));
  out.push(C.dim(`${brief.blurb}`));
  out.push(C.dim(`Window ${istTime(brief.window.from)}–${istTime(brief.window.to)} IST (${brief.window.hours}h)`));

  if (brief.coverage !== 'complete') {
    out.push('');
    out.push(C.yellow(`⚠ ${brief.coverage}`));
    out.push('');
    return out.join('\n');
  }

  out.push(C.dim(`${brief.total} signal(s): ` + Object.entries(brief.counts)
    .filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ')));

  if (brief.highlights.length) {
    out.push('');
    out.push(C.bold('Highlights'));
    for (const s of brief.highlights) {
      out.push(`${mark[s.severity]} ${C.dim(istTime(s.ts))} ${s.agent.padEnd(8)} ${s.title}`);
      for (const line of String(s.body || '').split('\n').filter(Boolean).slice(0, 3)) {
        out.push(`      ${C.dim(line)}`);
      }
    }
  }

  if (brief.awaiting.length) {
    out.push('');
    out.push(C.bold(`Awaiting you (${brief.awaiting.length})`));
    for (const s of brief.awaiting) {
      out.push(`   ${C.yellow('◆')} ${s.title} ${C.dim(`[${s.action.type}]`)}`);
    }
  }

  const routine = brief.signals.filter(s => s.severity === 'routine');
  if (routine.length) {
    out.push('');
    out.push(C.dim(`Routine (${routine.length})`));
    for (const s of routine.slice(0, 10)) {
      out.push(C.dim(`      ${istTime(s.ts)} ${s.agent.padEnd(8)} ${s.title}`));
    }
  }
  out.push('');
  return out.join('\n');
}

/** Persist for the dashboard to read in phase 3 (mirrors the Blob layout in §5.3). */
export function save(brief) {
  mkdirSync(paths.briefs, { recursive: true });
  const stamp = `${brief.date}-${istParts(new Date(brief.generatedAt)).hour}`.replace(/:/g, '');
  const latest = join(paths.briefs, 'latest.json');
  const archive = join(paths.briefs, `${brief.kind}-${stamp}.json`);
  const json = JSON.stringify(brief, null, 2);
  writeFileSync(latest, json);
  writeFileSync(archive, json);
  return { latest, archive };
}
