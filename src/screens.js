// Screen definitions shared by the Screener page and the end-of-day push digest.
// A screen is a list of conditions over the metrics produced by lib/nse.js
// buildScreen(). Keep this file dependency-free so the server can import it.

export const FIELDS = {
  score: { label: 'Score', unit: '', step: 5 },
  change: { label: '1D %', unit: '%', step: 0.5 },
  r1w: { label: '1W %', unit: '%', step: 1 },
  r1m: { label: '1M %', unit: '%', step: 1 },
  r3m: { label: '3M %', unit: '%', step: 1 },
  r6m: { label: '6M %', unit: '%', step: 1 },
  r1y: { label: '1Y %', unit: '%', step: 5 },
  rs3m: { label: 'RS vs Nifty 3M', unit: 'pts', step: 1 },
  rsi: { label: 'RSI 14', unit: '', step: 1 },
  fromHigh: { label: 'From 52W high', unit: '%', step: 1 },
  fromLow: { label: 'From 52W low', unit: '%', step: 5 },
  volatility: { label: 'Volatility 20D', unit: '%', step: 1 },
  volRatio: { label: 'Volume vs 20D', unit: '×', step: 0.1 },
  delivPct: { label: 'Delivery %', unit: '%', step: 1 },
  delivRatio: { label: 'Delivery vs 20D', unit: '×', step: 0.1 },
  turnoverCr: { label: 'Avg turnover', unit: '₹ Cr', step: 1 },
};
export const FLAGS = { above50: 'Above 50 DMA', above200: 'Above 200 DMA', golden: '50 DMA > 200 DMA', freshCross: 'Fresh golden cross', breakout20: '20-day breakout', trendTemplate: 'Minervini trend template' };

// Conditions: [field, 'min'|'max', value] or [flag, 'is', true|false].
export const PRESETS = [
  { id: 'momentum', name: 'Momentum leaders', note: 'Top composite score, in a long-term uptrend, not stretched.', when: [['score', 'min', 85], ['above200', 'is', true], ['rsi', 'max', 78]] },
  { id: 'minervini', name: 'Minervini trend template', note: 'Stage-2 structure: price > 50 > 150 > 200 DMA, 200 DMA rising for a month, ≥30% above the 52W low, within 25% of the high, composite score ≥ 70 as the relative-strength leg.', when: [['trendTemplate', 'is', true], ['score', 'min', 70]] },
  { id: 'high52', name: 'Near 52W high + volume', note: 'Within 3% of the 52-week high on 1.5× normal volume.', when: [['fromHigh', 'min', -3], ['volRatio', 'min', 1.5]] },
  { id: 'breakout20', name: '20-day breakout', note: 'Closed above the prior 20-session high with volume confirmation.', when: [['breakout20', 'is', true], ['volRatio', 'min', 1.3]] },
  { id: 'accumulation', name: 'Delivery accumulation', note: 'Delivered quantity ≥1.8× its 20-day average into an up close.', when: [['delivRatio', 'min', 1.8], ['delivPct', 'min', 45], ['change', 'min', 0]] },
  { id: 'pullback', name: 'Pullback in uptrend', note: 'Golden-cross trend with RSI cooled to 35–50 after a down week.', when: [['golden', 'is', true], ['above200', 'is', true], ['rsi', 'min', 35], ['rsi', 'max', 50], ['r1w', 'max', 0]] },
  { id: 'rs', name: 'Relative strength', note: 'Beating the Nifty 50 by 10+ points over 3 months and still rising.', when: [['rs3m', 'min', 10], ['r1m', 'min', 0]] },
  { id: 'golden', name: 'Fresh golden cross', note: '50 DMA crossed above 200 DMA in the last 10 sessions.', when: [['freshCross', 'is', true]] },
  { id: 'volume', name: 'Volume surge', note: 'Twice the 20-day volume on a green day.', when: [['volRatio', 'min', 2], ['change', 'min', 0]] },
  { id: 'squeeze', name: 'Low-volatility uptrend', note: 'Above the 50 DMA with 20-day volatility under 22%.', when: [['above50', 'is', true], ['volatility', 'max', 22], ['r3m', 'min', 0]] },
  { id: 'oversold', name: 'Oversold', note: 'RSI below 30 — mean-reversion watchlist, not a buy signal.', when: [['rsi', 'max', 30]] },
];

// Public guide links may select only a built-in screen; never import arbitrary URL rules.
export function presetFromSearch(search = '') {
  const params = new URLSearchParams(search);
  const id = params.get('screen');
  return params.get('page') === 'Screener' && PRESETS.some(p => p.id === id) ? id : null;
}

export function matches(row, when = []) {
  for (const [key, op, value] of when) {
    const v = row?.[key];
    if (op === 'is') { if (!!v !== !!value) return false; continue; }
    if (!Number.isFinite(v) || !Number.isFinite(value)) return false;
    if (op === 'min' && v < value) return false;
    if (op === 'max' && v > value) return false;
  }
  return true;
}

/** Validate an untrusted screen definition (from storage or a request body). */
export function cleanScreen(s) {
  if (!s || typeof s !== 'object') return null;
  const preset = PRESETS.find(p => p.id === s.id);
  const when = (Array.isArray(s.when) ? s.when : preset?.when || []).filter(c => Array.isArray(c) && (
    (c[0] in FIELDS && (c[1] === 'min' || c[1] === 'max') && Number.isFinite(Number(c[2]))) || (c[0] in FLAGS && c[1] === 'is')
  )).slice(0, 12).map(([k, op, v]) => [k, op, op === 'is' ? !!v : Number(v)]);
  const industry = typeof s.industry === 'string' ? s.industry.slice(0, 80) : '';
  if (!when.length && !industry) return null;
  return { id: String(s.id || 'custom').slice(0, 40), name: String(s.name || preset?.name || 'Custom screen').slice(0, 60), when, industry };
}

export function runScreen(rows, screen) {
  return (rows || []).filter(r => (!screen.industry || r.industry === screen.industry) && matches(r, screen.when));
}

export function describe(when = []) {
  return when.map(([k, op, v]) => op === 'is' ? `${v ? '' : 'Not '}${FLAGS[k] || k}` : `${FIELDS[k]?.label || k} ${op === 'min' ? '≥' : '≤'} ${v}${FIELDS[k]?.unit && FIELDS[k].unit !== '₹ Cr' ? FIELDS[k].unit : ''}${FIELDS[k]?.unit === '₹ Cr' ? ' Cr' : ''}`).join(' · ');
}
