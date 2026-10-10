// Turns raw headline feeds into stories (blueprint §6, rebuilt).
//
// A news feed returns the same event many times — ten outlets reporting the same
// tanker strike are one story, and how many outlets carried it is the best cheap
// signal of how much it matters. So: clean each title, drop off-topic items,
// group headlines that describe the same event, and rank groups by breadth of
// coverage. Pure functions, no network, so all of it is testable on fixtures.

/** What each theme is about. An item mentioning none of these is off-topic noise. */
export const THEME_TERMS = {
  hormuz: ['hormuz', 'iran', 'iranian', 'irgc', 'tanker', 'tankers', 'red sea', 'houthi', 'houthis', 'oil', 'crude', 'brent', 'opec', 'gulf', 'shipping', 'lpg'],
  india: ['rbi', 'rupee', 'inflation', 'crr', 'repo', 'g sec', 'gsec', 'bond', 'bonds', 'forex', 'fii', 'fiis', 'fpi', 'fpis', 'gdp', 'sensex', 'nifty', 'sebi', 'india', 'indian'],
  // No bare "powell": it also matches the actor Glen Powell.
  fed: ['fed', 'fomc', 'federal reserve', 'treasury', 'treasuries', 'yield', 'yields', 'inflation', 'rate', 'rates', 'cpi', 'jobs', 'payrolls', 'wall street', 'nasdaq', 's&p'],
  // No bare "yen": it also matches Hung Yen, a Vietnamese province.
  asia: ['japan', 'japanese', 'boj', 'bank of japan', 'nikkei', 'china', 'chinese', 'korea', 'korean', 'kospi', 'asia', 'asian', 'hang seng', 'pboc', 'yuan']
};

/**
 * The words a theme's feed query was built around. Nearly every headline in the
 * feed contains them, so they say nothing about WHICH event a headline is about
 * and are ignored when grouping. (Deliberately a fixed list: deriving it from
 * word frequency backfires when one story dominates the feed, because that
 * story's own key words then look "common" and get thrown away.)
 */
const ANCHORS = {
  hormuz: ['hormuz', 'strait', 'iran', 'irgc'],
  india: ['india', 'rbi'],
  fed: ['fed', 'federal', 'reserve'],
  asia: ['asia', 'japan', 'japanese']
};

export const THEME_LABELS = {
  hormuz: 'Iran · Hormuz · Oil',
  india: 'India · RBI · Rupee',
  fed: 'US · Fed · Rates',
  asia: 'Asia markets'
};

// Outlets preferred for a story's headline when several carried it — not a
// trust ranking, just the ones whose headlines tend to be plain and factual.
const PREFERRED = [
  'reuters', 'bloomberg', 'financial times', 'the wall street journal', 'associated press', 'ap news',
  'the economic times', 'livemint', 'mint', 'business standard', 'moneycontrol', 'businessline',
  'cnbc', 'cnbc tv18', 'bbc', 'ndtv', 'the hindu', 'hindustan times', 'times of india', 'yahoo'
];

const STOP = new Set(`a an the of in on at to for from by with and or but is are was were be been
 as it its this that these those after before over under into amid against via says said say
 will would could may might new more most than then there their they he she we you i not no
 up down out off about what why how who when where which while just also today now amid us`
  .split(/\s+/).filter(Boolean));

/** Google News appends " - Publisher" to every title; strip it. */
export function cleanTitle(title, source = '') {
  let t = String(title || '').replace(/\s+/g, ' ').trim();
  const src = String(source || '').trim();
  if (src && t.endsWith(` - ${src}`)) t = t.slice(0, -(src.length + 3)).trim();
  else {
    const i = t.lastIndexOf(' - ');
    if (i > 20 && t.length - i < 60) t = t.slice(0, i).trim();
  }
  // Some outlets also brand the title itself: "… | FXStreet".
  const bar = t.lastIndexOf(' | ');
  if (bar > 20 && t.length - bar < 30) t = t.slice(0, bar).trim();
  return t;
}

/** Lowercase content words with a light stem, so "attacked"/"attacks"/"attack" match. */
export function tokens(text) {
  return [...new Set(
    String(text || '').toLowerCase()
      .replace(/[’']s\b/g, '')
      .replace(/[^a-z0-9$%.\s-]/g, ' ')
      .split(/[\s-]+/)
      .map(w => w.replace(/^\.+|\.+$/g, ''))
      .filter(w => w.length > 2 && !STOP.has(w))
      .map(w => w === 'iranian' ? 'iran'
        : w.length > 5 && w.endsWith('ing') ? w.slice(0, -3)
        : w.length > 4 && w.endsWith('ed') ? w.slice(0, -2)
        : w.length > 4 && w.endsWith('es') ? w.slice(0, -2)
        : w.length > 3 && w.endsWith('s') ? w.slice(0, -1)
        : w)
  )];
}

/** Whole-word match, so "rate" matches "rate" but not "pirate". */
export function isRelevant(title, theme) {
  const t = ` ${String(title).toLowerCase().replace(/[’']s\b/g, '').replace(/[^a-z0-9&]+/g, ' ')} `;
  return (THEME_TERMS[theme] || []).some(term => t.includes(` ${term} `));
}

/**
 * Group items describing the same event. A theme's anchor words are ignored
 * (see ANCHORS); two headlines join when they share at least two of the
 * remaining words and overlap meaningfully.
 */
export function cluster(items, theme = null) {
  const anchors = new Set(ANCHORS[theme] || []);
  const rows = items.map(item => ({ item, key: tokens(item.title).filter(w => !anchors.has(w)) }));

  const groups = [];
  for (const r of rows) {
    let best = null, bestScore = 0;
    for (const g of groups) {
      for (const m of g.members) {
        const shared = r.key.filter(w => m.key.includes(w)).length;
        const union = new Set([...r.key, ...m.key]).size || 1;
        const jac = shared / union;
        if (shared >= 2 && jac >= 0.2 && jac > bestScore) { best = g; bestScore = jac; }
      }
    }
    if (best) best.members.push(r);
    else groups.push({ members: [r] });
  }
  return groups.map(g => g.members.map(m => m.item));
}

function pickHeadline(members) {
  const rank = m => {
    const i = PREFERRED.indexOf(String(m.source || '').toLowerCase());
    return i === -1 ? PREFERRED.length : i;
  };
  return [...members].sort((a, b) => rank(a) - rank(b) || (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))[0];
}

/** Stable identity for "is this story new since the last brief". */
export function storyKey(story) {
  return tokens(story.title).filter(w => !['iran', 'hormuz', 'strait', 'rbi', 'india'].includes(w)).sort().slice(0, 6).join(' ');
}

/**
 * Build ranked stories for one theme from a raw feed.
 * @returns {object[]} stories, widest-covered first
 */
export function storiesFor(theme, rawItems, { now = new Date(), maxAgeHours = 36, limit = 6 } = {}) {
  const cutoff = now.getTime() - maxAgeHours * 3600_000;
  const items = (rawItems || [])
    .map(x => ({ ...x, title: cleanTitle(x.title, x.source), source: String(x.source || '').trim() }))
    .filter(x => x.title && x.url && /^https:\/\//.test(x.url))
    .filter(x => !/^opinion\b/i.test(x.title))
    .filter(x => { const t = Date.parse(x.date); return !Number.isFinite(t) || t >= cutoff; })
    .filter(x => isRelevant(x.title, theme));

  return cluster(items, theme).map(members => {
    const lead = pickHeadline(members);
    const sources = [...new Set(members.map(m => m.source).filter(Boolean))];
    const latest = members.map(m => Date.parse(m.date)).filter(Number.isFinite).sort((a, b) => b - a)[0];
    return {
      theme,
      title: lead.title,
      outlets: sources.length || members.length,
      sources: sources.slice(0, 6),
      latest: Number.isFinite(latest) ? new Date(latest).toISOString() : null,
      links: [lead, ...members.filter(m => m !== lead)].slice(0, 3)
        .map(m => ({ source: m.source, url: m.url, title: m.title }))
    };
  })
    .sort((a, b) => b.outlets - a.outlets || (Date.parse(b.latest) || 0) - (Date.parse(a.latest) || 0))
    .slice(0, limit);
}
