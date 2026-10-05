// Agent 1 — Market Research & News (blueprint §6).
//
// Three steps per theme, and only the third would ever need a model:
//   1. FETCH    quotes + lead instrument history + theme headlines
//   2. DETECT   materiality.assess() — deterministic, no model call
//   3. NARRATE  phrase the detected fact
//
// Phase 2 implements 1 and 2 and writes step 3 from a template. That is not a
// placeholder for lack of time: the template can only restate numbers that are
// already in evidence[], which is exactly the constraint the narration step is
// supposed to operate under. Swapping in a model call later changes the prose,
// not the claims.
import { assess } from '../materiality.mjs';
import { MarketClient } from '../market.mjs';

/** Global cues for the overnight read. KOSPI joins the row it belongs in. */
export const GLOBAL_CUES = [
  ['^GSPC', 'S&P 500'], ['^IXIC', 'Nasdaq'], ['^N225', 'Nikkei'], ['^KS11', 'KOSPI'],
  ['BZ=F', 'Brent'], ['GC=F', 'Gold'], ['INR=X', 'USD/INR'], ['^TNX', 'US 10Y'],
  ['^NSEI', 'Nifty 50'], ['^INDIAVIX', 'India VIX']
];

const THEMES_BY_INTENT = {
  overnight_wrap: ['fed', 'asia', 'hormuz'],
  delta_scan: ['india', 'hormuz'],
  geopolitical_scan: ['hormuz']
};

const pct = n => (Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : 'n/a');
const num = n => (Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : 'n/a');

/** Subjects a theme signal is about — the refs Jarvis correlates on (§4.3a). */
function subjectsFor(theme, lead, linked) {
  return [
    { type: 'theme', ref: theme },
    { type: 'instrument', ref: lead },
    ...linked.map(l => ({
      type: String(l.symbol).startsWith('^CNX') || String(l.symbol).startsWith('^NSEBANK')
        ? 'sector' : 'instrument',
      ref: l.symbol
    }))
  ];
}

/**
 * Evidence for a theme verdict: the price reading, the coherence votes, and up to
 * three headlines. Every number the narration may use has to appear here — that
 * is what makes the envelope's evidence rule bite rather than decorate.
 */
function evidenceFor({ verdict, lead, leadQuote, items, sessions }) {
  const evidence = [{
    source: 'Yahoo Finance via /api/market',
    value: leadQuote?.price ?? null,
    symbol: lead,
    changePct: Number.isFinite(leadQuote?.change) ? Number(leadQuote.change.toFixed(2)) : null,
    sigma: verdict.sigma === null ? null : Number(verdict.sigma.toFixed(2)),
    baselineSessions: sessions,
    fetchedAt: leadQuote?.fetchedAt || new Date().toISOString()
  }];

  for (const d of verdict.coherence.detail) {
    evidence.push({
      source: 'Yahoo Finance via /api/market',
      symbol: d.symbol,
      value: Number(d.change.toFixed(2)),
      expectedDirection: d.expected > 0 ? 'up' : 'down',
      agreed: d.agreed
    });
  }

  for (const item of (items || []).slice(0, 3)) {
    if (!item.url) continue;
    evidence.push({
      source: `${item.source || 'Google News'} via Google News`,
      url: item.url,
      title: item.title,
      publishedAt: item.date || null
    });
  }
  return evidence;
}

function narrate({ theme, verdict, lead, leadQuote, items }) {
  const move = `${lead} ${pct(leadQuote?.change)} at ${num(leadQuote?.price)}`;
  if (!verdict.material) {
    return {
      title: `${theme}: no material development (${move})`,
      body: [
        `Gate not met, so this is logged as routine rather than escalated.`,
        ...verdict.failed.map(f => `· ${f}`),
        ...verdict.reasons.map(r => `· ${r} (met)`)
      ].join('\n')
    };
  }
  const headline = items?.[0]?.title;
  const aligned = verdict.coherence.detail
    .filter(d => d.agreed)
    .map(d => `${d.symbol} ${pct(d.change)}`)
    .join(', ');
  return {
    title: `${move} on ${theme} coverage${headline ? ` — ${headline.slice(0, 90)}` : ''}`,
    body: [
      `${move}, ${verdict.sigma >= 0 ? '+' : ''}${verdict.sigma.toFixed(2)}σ against its trailing 20-session daily return.`,
      `${verdict.publishers.length} publishers carried the theme in the last 6 hours: ${verdict.publishers.slice(0, 4).join(', ')}.`,
      aligned ? `Moving with it: ${aligned}.` : '',
      `Co-occurrence of a move and coverage. Not a causal claim — see evidence for sources.`
    ].filter(Boolean).join('\n')
  };
}

/** Run one theme end to end. Returns the emitted signal, or null on data failure. */
async function runTheme(theme, { client, bus, now }) {
  let feed;
  try {
    feed = await client.theme(theme);
  } catch (e) {
    // A dead upstream is reported, not narrated around.
    bus.tryEmit({
      agent: 'macro', kind: 'observation', severity: 'routine',
      title: `${theme}: news feed unavailable`,
      body: e.message,
      subjects: [{ type: 'theme', ref: theme }],
      evidence: [{ source: 'Google News via /api/market', value: 'unavailable', error: e.message }]
    });
    return null;
  }

  const { lead, linked, items } = feed;
  const symbols = [lead, ...linked.map(l => l.symbol)];
  const [{ quotes }, leadCloses] = await Promise.all([
    client.quotes(symbols),
    client.dailyCloses(lead).catch(() => [])
  ]);

  const leadQuote = quotes[lead];
  const verdict = assess({
    theme,
    leadChange: leadQuote?.change,
    leadCloses,
    items,
    linked,
    quotes,
    now
  });

  const { title, body } = narrate({ theme, verdict, lead, leadQuote, items });
  const result = bus.tryEmit({
    agent: 'macro',
    kind: 'observation',
    severity: verdict.severity,
    confidence: verdict.confidence,
    title,
    body,
    subjects: subjectsFor(theme, lead, linked),
    evidence: evidenceFor({ verdict, lead, leadQuote, items, sessions: leadCloses.length }),
    // Routine readings go stale fast; a material one is worth carrying to the
    // next brief so correlation and the stale-conviction check can see it.
    expiresAt: new Date(now.getTime() + (verdict.material ? 6 : 1) * 3600_000).toISOString()
  });

  return result.ok ? result.signal : null;
}

/** Cross-asset snapshot for the overnight brief. */
async function overnightCues({ client, bus, now }) {
  const { quotes, missing } = await client.quotes(GLOBAL_CUES.map(c => c[0]));
  const present = GLOBAL_CUES.filter(([s]) => Number.isFinite(quotes[s]?.change));
  if (!present.length) {
    bus.tryEmit({
      agent: 'macro', kind: 'observation', severity: 'routine',
      title: 'Overnight cues unavailable',
      body: `No quotes returned for ${missing.length} symbol(s).`,
      evidence: [{ source: '/api/market', value: 'unavailable', missing: missing.join(',') }]
    });
    return null;
  }

  const ranked = present
    .map(([symbol, name]) => ({ symbol, name, change: quotes[symbol].change, price: quotes[symbol].price }))
    .sort((a, b) => b.change - a.change);

  const result = bus.tryEmit({
    agent: 'macro',
    kind: 'observation',
    severity: 'routine',
    title: `Overnight: ${ranked[0].name} ${pct(ranked[0].change)}, ${ranked.at(-1).name} ${pct(ranked.at(-1).change)}`,
    body: ranked.map(r => `${r.name.padEnd(10)} ${num(r.price).padStart(12)}  ${pct(r.change)}`).join('\n')
      + (missing.length ? `\n\nUnavailable: ${missing.join(', ')}` : ''),
    subjects: ranked.map(r => ({ type: 'instrument', ref: r.symbol })),
    evidence: ranked.map(r => ({
      source: 'Yahoo Finance via /api/market', symbol: r.symbol,
      value: r.price, changePct: Number(r.change.toFixed(2))
    })),
    expiresAt: new Date(now.getTime() + 8 * 3600_000).toISOString()
  });
  return result.ok ? result.signal : null;
}

async function scan(intent, { bus, task, now = new Date() }) {
  const client = new MarketClient();
  let signals = 0;

  if (intent === 'overnight_wrap' && await overnightCues({ client, bus, now })) signals++;

  for (const theme of THEMES_BY_INTENT[intent] || []) {
    // Themes are independent; one failing must not lose the others.
    try {
      if (await runTheme(theme, { client, bus, now })) signals++;
    } catch (e) {
      bus.tryEmit({
        agent: 'macro', kind: 'observation', severity: 'routine',
        title: `${theme}: scan failed`,
        body: e.message,
        subjects: [{ type: 'theme', ref: theme }],
        evidence: [{ source: 'jarvis/macro', value: 'error', error: e.message }]
      });
    }
  }

  // No model calls yet, so tokens are genuinely zero. Reporting a made-up number
  // here would corrupt the budget governor's only input.
  return { signals, tokens: 0, toolCalls: client.calls };
}

export const macro = {
  name: 'macro',
  tools: ['market'],
  intents: {
    overnight_wrap: ctx => scan('overnight_wrap', ctx),
    delta_scan: ctx => scan('delta_scan', ctx),
    geopolitical_scan: ctx => scan('geopolitical_scan', ctx)
  }
};

export default macro;
