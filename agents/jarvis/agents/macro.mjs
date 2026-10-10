// Agent 1 — Market Research & News.
//
// One run produces ONE research brief:
//   1. a market snapshot — Brent, gold, US and Asian indices, India, rupee, yields
//   2. the news, turned into stories: the same event from ten outlets is one
//      story "reported by 10 outlets", grouped by topic, new ones marked
//   3. an analysis of what it means for Indian markets, from Claude, when an
//      API key is configured — stated plainly as off when it is not
//
// The materiality gate no longer decides whether you hear about the news. It
// only sets how loudly: a price-confirmed move raises the brief's severity.
import { assess } from '../materiality.mjs';
import { MarketClient } from '../market.mjs';
import { storiesFor, storyKey, THEME_LABELS } from '../news.mjs';
import { analyse } from '../analyst.mjs';

/** The snapshot, in the order a trader reads it. `inverse`: up is bad for Indian equities. */
export const SNAPSHOT = [
  { symbol: 'BZ=F', name: 'Brent crude', unit: '$' },
  { symbol: 'GC=F', name: 'Gold', unit: '$' },
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^IXIC', name: 'Nasdaq' },
  { symbol: '^N225', name: 'Nikkei 225' },
  { symbol: '^KS11', name: 'KOSPI' },
  { symbol: '^NSEI', name: 'Nifty 50' },
  { symbol: '^NSEBANK', name: 'Bank Nifty' },
  { symbol: '^INDIAVIX', name: 'India VIX', inverse: true },
  { symbol: 'INR=X', name: 'USD/INR', inverse: true },
  { symbol: '^TNX', name: 'US 10Y yield', unit: '%', inverse: true }
];

export const THEMES = ['hormuz', 'india', 'fed', 'asia'];

/** Story at least this widely covered, and new since the last brief, makes the brief notable. */
export const WIDE_COVERAGE = 8;

const round = (n, d = 2) => (Number.isFinite(n) ? Number(n.toFixed(d)) : null);
const fiveDay = spark => {
  const s = (spark || []).filter(Number.isFinite);
  return s.length > 1 && s[0] > 0 ? (s.at(-1) / s[0] - 1) * 100 : null;
};

export function snapshotRows(quotes) {
  return SNAPSHOT.map(({ symbol, name, unit, inverse }) => {
    const q = quotes[symbol];
    return {
      symbol, name, unit: unit || '', inverse: Boolean(inverse),
      price: round(q?.price),
      change: round(q?.change),
      change5d: round(fiveDay(q?.spark)),
      asOf: Number.isFinite(q?.marketTime) ? new Date(q.marketTime * 1000).toISOString() : null
    };
  });
}

/** The last brief's stories, so this one can mark what is new. */
function previousKeys(store) {
  const last = store.listSignals({ agent: 'macro', limit: 10 }).find(s => s.data?.kind === 'research_brief');
  return new Set((last?.data?.stories || []).map(s => s.key));
}

/**
 * How much a theme's stories count toward the headline when no analysis is
 * available to judge. This brief is for an Indian trader: an RBI move covered by
 * 8 outlets should lead over a US political story covered by 16.
 */
export const HEADLINE_WEIGHT = { india: 2, hormuz: 1.6, fed: 1, asia: 0.8 };

/** A readable headline and body for when the analysis step is off or failed. */
function plainSummary(rows, stories) {
  const weight = s => s.outlets * (HEADLINE_WEIGHT[s.theme] || 1);
  const byWeight = list => [...list].sort((a, b) => weight(b) - weight(a));
  const top = byWeight(stories.filter(s => s.isNew))[0] || byWeight(stories)[0];
  const move = r => r && r.price !== null
    ? `${r.name} ${r.unit === '$' ? '$' : ''}${r.price.toLocaleString('en-IN')}${r.unit === '%' ? '%' : ''} (${r.change >= 0 ? '+' : ''}${r.change}%)`
    : null;
  const pick = sym => rows.find(r => r.symbol === sym);
  const markets = ['BZ=F', 'GC=F', '^NSEI', '^GSPC', 'INR=X'].map(s => move(pick(s))).filter(Boolean).join(' · ');
  return {
    title: top ? `${top.title} (${top.outlets} outlet${top.outlets === 1 ? '' : 's'})` : `Markets: ${markets}`,
    body: [
      markets,
      ...THEMES.map(t => {
        const s = stories.filter(x => x.theme === t);
        return s.length ? `${THEME_LABELS[t]}: ${s.slice(0, 2).map(x => x.title).join('; ')}` : null;
      }).filter(Boolean)
    ].join('\n')
  };
}

async function researchBrief({ bus, store, now = new Date() }) {
  const client = new MarketClient();

  // 1. News for every theme, in parallel. A failed theme is noted, not fatal.
  const feeds = await Promise.all(THEMES.map(t =>
    client.theme(t, { days: 2 }).then(f => ({ theme: t, feed: f })).catch(e => ({ theme: t, error: e.message }))
  ));

  // 2. One quote call covers the snapshot and every theme's linked instruments.
  const symbols = new Set(SNAPSHOT.map(s => s.symbol));
  for (const { feed } of feeds) {
    if (!feed) continue;
    symbols.add(feed.lead);
    for (const l of feed.linked || []) symbols.add(l.symbol);
  }
  const { quotes, missing } = await client.quotes([...symbols]);
  const rows = snapshotRows(quotes);

  // 3. Stories, numbered across themes so the analysis can cite them.
  const seen = previousKeys(store);
  const stories = [];
  for (const { theme, feed } of feeds) {
    if (!feed) continue;
    for (const s of storiesFor(theme, feed.items, { now })) {
      const key = storyKey(s);
      stories.push({ ...s, id: stories.length + 1, key, isNew: !seen.has(key), themeLabel: THEME_LABELS[theme] });
    }
  }

  if (!stories.length && !rows.some(r => r.price !== null)) {
    bus.emit({
      agent: 'macro', kind: 'observation', severity: 'routine',
      title: 'Market research unavailable — no news or prices could be fetched',
      body: [...feeds.filter(f => f.error).map(f => `${f.theme}: ${f.error}`), missing.length ? `quotes missing: ${missing.join(', ')}` : ''].filter(Boolean).join('\n'),
      evidence: [{ source: 'market API', value: 'unavailable' }]
    });
    return { signals: 1, tokens: 0, toolCalls: client.calls };
  }

  // 4. Price confirmation per theme — sets severity only.
  const gates = [];
  for (const { theme, feed } of feeds) {
    if (!feed) continue;
    const closes = await client.dailyCloses(feed.lead).catch(() => []);
    const v = assess({
      theme, leadChange: quotes[feed.lead]?.change, leadCloses: closes,
      items: feed.items, linked: feed.linked, quotes, now
    });
    gates.push({ theme, lead: feed.lead, material: v.material, severity: v.severity, sigma: round(v.sigma), failed: v.failed });
  }

  // 5. Analysis.
  const result = await analyse({ snapshot: rows, stories });

  const priceSeverity = gates.some(g => g.severity === 'elevated') ? 'elevated'
    : gates.some(g => g.severity === 'notable') ? 'notable' : 'routine';
  const bigNewStory = stories.some(s => s.isNew && s.outlets >= WIDE_COVERAGE);
  const severity = priceSeverity !== 'routine' ? priceSeverity : bigNewStory ? 'notable' : 'routine';

  const plain = plainSummary(rows, stories);
  const title = result.status === 'ok' ? result.analysis.headline : plain.title;
  const body = result.status === 'ok' ? result.analysis.summary : plain.body;

  bus.emit({
    agent: 'macro',
    kind: 'observation',
    severity,
    title: title.length > 200 ? `${title.slice(0, 197)}…` : title,
    body,
    subjects: [
      ...THEMES.map(t => ({ type: 'theme', ref: t })),
      ...rows.filter(r => r.price !== null).map(r => ({ type: 'instrument', ref: r.symbol }))
    ],
    evidence: [
      ...rows.filter(r => r.price !== null).map(r => ({
        source: 'Yahoo Finance via market API', symbol: r.symbol, value: r.price, changePct: r.change, fetchedAt: r.asOf || undefined
      })),
      ...[...stories].sort((a, b) => b.outlets - a.outlets).slice(0, 4).map(s => ({
        source: `${s.links[0]?.source || 'news'} (${s.outlets} outlet${s.outlets === 1 ? '' : 's'})`,
        url: s.links[0]?.url, title: s.title, publishedAt: s.latest || undefined
      })).filter(e => e.url)
    ],
    data: {
      kind: 'research_brief',
      generatedAt: now.toISOString(),
      snapshot: rows,
      missing,
      stories,
      themes: THEME_LABELS,
      gates,
      feedErrors: feeds.filter(f => f.error).map(f => ({ theme: f.theme, error: f.error })),
      analysis: result.status === 'ok'
        ? { status: 'ok', model: result.model, via: result.via, unverified: result.unverified, ...result.analysis }
        : { status: result.status, reason: result.reason, ...(result.fix ? { fix: result.fix } : {}) }
    },
    expiresAt: new Date(now.getTime() + 6 * 3600_000).toISOString()
  });

  return {
    signals: 1,
    tokens: result.tokens || 0,
    toolCalls: client.calls + (result.status === 'off' ? 0 : 1)
  };
}

export const macro = {
  name: 'macro',
  tools: ['market'],
  intents: {
    research_brief: ctx => researchBrief(ctx)
  }
};

export default macro;
